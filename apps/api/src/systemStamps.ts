// Service->Database: System Stamps (AGENTS_TO_DO.md, 2026-08-30) - a
// snapshot of the "config" half of this project's own Postgres data
// (everything except log_* tables), saved as a plain JSON file on disk
// (config.systemStamps.dir), not a row in the very database it snapshots.
// Save/Apply/Delete work the same way whether the file came from this
// project's own "Save State" or a user's "Upload State" - both funnel
// through applyStampDump() below.

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { config } from "./config.js";
import { pool } from "./db.js";
import { initUnreadCounts } from "./processMessages.js";

// Topological (parent-before-child) order for the tables that make up a
// System Stamp - matches this project's own FK graph, checked live
// (2026-08-30): users/every *_groups/message_* table have no FK deps of
// their own, nodes depends on node_groups, devices depends on nodes,
// processes depends on devices+nodes+process_groups, and the three join
// tables each depend on their own two parents. TRUNCATE ... CASCADE
// (applyStampDump below) doesn't care about this order, but the
// subsequent per-row INSERTs do.
export const CONFIG_TABLES = [
  "users",
  "node_groups",
  "device_groups",
  "process_groups",
  "tab_groups",
  "message_groups",
  "message_levels",
  "message_signal_timing",
  "light_templates",
  "nodes",
  "devices",
  "processes",
  "device_device_groups",
  "process_tab_groups",
  "process_message_groups",
] as const;

// Excluded from both buckets on purpose: `library_categories`/`library_items`
// are re-derived from disk on every Library sync (restoring stale rows
// would just fight the live sync), `pgmigrations` is schema-version
// bookkeeping, not user data (read below only to embed/compare a
// compatibility signature, never dumped/restored itself).
export const LOG_TABLES = ["log_command", "log_device", "log_messages"] as const;

const DUMP_FORMAT_VERSION = 1;

export interface StampDump {
  formatVersion: number;
  projectName: string;
  createdAt: string;
  name: string;
  migrations: string[];
  tables: Record<string, Record<string, unknown>[]>;
}

export interface StampListEntry {
  filename: string;
  name: string;
  createdAt: string;
  sizeBytes: number;
  migrations: string[];
}

async function appliedMigrationNames(): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>("SELECT name FROM pgmigrations ORDER BY name");
  return rows.map((r) => r.name);
}

function stampsDir(): string {
  return config.systemStamps.dir;
}

async function ensureDir(): Promise<void> {
  await mkdir(stampsDir(), { recursive: true });
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "stamp";
}

/** Builds a dump of the current live config tables - does not write it
 * anywhere, callers decide whether to persist (createStampFile) or stream
 * it straight to the client (Download State, routes/serviceDatabase.ts). */
export async function buildStampDump(name: string): Promise<StampDump> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of CONFIG_TABLES) {
    const { rows } = await pool.query(`SELECT * FROM ${table}`);
    tables[table] = rows;
  }
  return {
    formatVersion: DUMP_FORMAT_VERSION,
    projectName: config.postgres.database,
    createdAt: new Date().toISOString(),
    name,
    migrations: await appliedMigrationNames(),
    tables,
  };
}

/** Save State - snapshot now, persisted as a file. */
export async function createStampFile(name: string): Promise<StampListEntry> {
  await ensureDir();
  const dump = await buildStampDump(name);
  const filename = `${dump.createdAt.replace(/[:.]/g, "-")}-${slugify(name)}-${randomUUID().slice(0, 8)}.json`;
  const json = JSON.stringify(dump, null, 2);
  await writeFile(path.join(stampsDir(), filename), json, "utf-8");
  return { filename, name: dump.name, createdAt: dump.createdAt, sizeBytes: Buffer.byteLength(json), migrations: dump.migrations };
}

export async function listStampFiles(): Promise<StampListEntry[]> {
  await ensureDir();
  const entries = await readdir(stampsDir(), { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && e.name.endsWith(".json"));
  const results = await Promise.all(
    files.map(async (entry) => {
      const filePath = path.join(stampsDir(), entry.name);
      const [raw, stats] = await Promise.all([readFile(filePath, "utf-8"), stat(filePath)]);
      try {
        const dump = JSON.parse(raw) as StampDump;
        return {
          filename: entry.name,
          name: dump.name ?? entry.name,
          createdAt: dump.createdAt ?? stats.mtime.toISOString(),
          sizeBytes: stats.size,
          migrations: dump.migrations ?? [],
        };
      } catch {
        // A file that doesn't parse as our own dump format (manually
        // dropped in, corrupted) still shows up rather than silently
        // vanishing - just with best-effort metadata from the filesystem,
        // and applyStampDump's own JSON.parse will reject it properly if
        // an operator actually tries to Apply it.
        return { filename: entry.name, name: entry.name, createdAt: stats.mtime.toISOString(), sizeBytes: stats.size, migrations: [] };
      }
    }),
  );
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function stampFilePath(filename: string): string {
  // `filename` always comes straight from a route param that ends up in a
  // filesystem path (below and in routes/serviceDatabase.ts) - reject any
  // path-separator content outright rather than relying on path.join to
  // somehow contain it.
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    throw new Error("invalid stamp filename");
  }
  return path.join(stampsDir(), filename);
}

export async function readStampFile(filename: string): Promise<StampDump> {
  const raw = await readFile(stampFilePath(filename), "utf-8");
  return JSON.parse(raw) as StampDump;
}

export async function deleteStampFile(filename: string): Promise<void> {
  await rm(stampFilePath(filename));
}

export class StampCompatibilityError extends Error {}

interface ColumnInfo {
  isJson: boolean;
}

let configColumnsCache: Map<string, Map<string, ColumnInfo>> | null = null;

/** Real column names + types per CONFIG_TABLE, read from information_schema.
 * Column names are the actual injection defense for applyStampDump's
 * dynamic INSERTs below (a dump's row keys become raw SQL column names,
 * and an uploaded dump is fully user-supplied). `isJson` fixes a real
 * round-trip bug found live (2026-08-30): `light_templates.channel_spectrum`
 * is a jsonb column whose value is a top-level JSON ARRAY - `pg`'s own
 * automatic value serialization checks `Array.isArray` BEFORE checking
 * "is this an object", so a JS array bound as a query parameter gets
 * formatted as a Postgres ARRAY literal (`{a,b}`), not JSON text -
 * exactly wrong for a jsonb column, and Postgres rejects it with "invalid
 * input syntax for type json". Only matters for jsonb/json columns whose
 * value happens to be an array - `processes.actions` (a REAL `text[]`
 * column) needs that exact same automatic array-literal formatting to
 * stay correct, so this can't be "always JSON.stringify arrays", it has
 * to be per-column, driven by the real schema. Cached after first read:
 * this project's own schema only changes via a migration + restart,
 * never at runtime. */
async function configColumns(): Promise<Map<string, Map<string, ColumnInfo>>> {
  if (configColumnsCache) return configColumnsCache;
  const { rows } = await pool.query<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [CONFIG_TABLES as unknown as string[]],
  );
  const map = new Map<string, Map<string, ColumnInfo>>();
  for (const row of rows) {
    if (!map.has(row.table_name)) map.set(row.table_name, new Map());
    map.get(row.table_name)!.set(row.column_name, { isJson: row.data_type === "json" || row.data_type === "jsonb" });
  }
  configColumnsCache = map;
  return map;
}

/** The "перевірка структури БД на відповідність" the user asked for - a
 * dump from a different project (wrong `projectName`, i.e. wrong
 * POSTGRES_DB) or a different schema version (its own `migrations` list
 * doesn't exactly match what's actually applied here) is rejected
 * outright rather than partially applied - there is no partial/best-effort
 * mode for something this destructive. Also validates every dumped row's
 * own column names against the real schema (see configColumns' own
 * comment) - both a stricter compatibility check and the actual defense
 * against a crafted column name reaching raw SQL in applyStampDump. */
async function assertCompatible(dump: StampDump): Promise<void> {
  if (dump.formatVersion !== DUMP_FORMAT_VERSION) {
    throw new StampCompatibilityError(`Unsupported dump format version ${dump.formatVersion}`);
  }
  if (dump.projectName !== config.postgres.database) {
    throw new StampCompatibilityError(
      `This stamp is from project "${dump.projectName}", not "${config.postgres.database}"`,
    );
  }
  const current = await appliedMigrationNames();
  const dumped = dump.migrations ?? [];
  if (current.length !== dumped.length || current.some((m, i) => m !== dumped[i])) {
    throw new StampCompatibilityError(
      "This stamp's database schema (applied migrations) doesn't match the current schema - run pending migrations or use a matching stamp",
    );
  }

  const columnsByTable = await configColumns();
  for (const table of CONFIG_TABLES) {
    const knownColumns = columnsByTable.get(table);
    for (const row of dump.tables[table] ?? []) {
      for (const column of Object.keys(row)) {
        if (!knownColumns?.has(column)) {
          throw new StampCompatibilityError(`Stamp table "${table}" has an unknown column "${column}"`);
        }
      }
    }
  }
}

/** JSON.stringify only what actually needs it (see configColumns' own
 * comment) - json/jsonb columns get their JS value explicitly re-encoded
 * as a JSON string (correct for both a JSON object AND a top-level JSON
 * array), everything else is passed through untouched so `pg`'s own
 * automatic formatting (Postgres ARRAY literals for `text[]`, ISO strings
 * for Date, etc.) still applies. */
function toQueryValue(value: unknown, column: ColumnInfo | undefined): unknown {
  if (column?.isJson && value !== null && value !== undefined) {
    return JSON.stringify(value);
  }
  return value;
}

/** Apply State - TRUNCATEs every config table together (CASCADE handles FK
 * ordering for the truncate itself) then re-inserts every dumped row,
 * table by table in CONFIG_TABLES' own topological order (INSERT does
 * care about FK order, unlike TRUNCATE). Whole thing is one transaction -
 * a failure partway through must never leave the DB half-restored. */
export async function applyStampDump(dump: StampDump): Promise<void> {
  await assertCompatible(dump);
  const columnsByTable = await configColumns();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`TRUNCATE ${CONFIG_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
    for (const table of CONFIG_TABLES) {
      const tableColumns = columnsByTable.get(table);
      for (const row of dump.tables[table] ?? []) {
        const columns = Object.keys(row);
        if (columns.length === 0) continue;
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
        await client.query(
          `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
          columns.map((c) => toQueryValue(row[c], tableColumns?.get(c))),
        );
      }
      // Every row above was inserted with its own explicit `id` (preserved
      // from the dump), which never advances a SERIAL column's sequence -
      // found live (2026-08-30): after RESTART IDENTITY reset every
      // sequence to 1, `devices_id_seq` was still sitting at 1 while real
      // rows went up to id 415, so the very next UI-created device would
      // have collided with an existing row.
      //
      // Guarded in JS, not SQL, on purpose - also found live:
      // `pg_get_serial_sequence(table, 'id')` only returns NULL when the
      // column EXISTS but has no sequence (message_signal_timing's fixed
      // singleton row); for a table with NO `id` column at all (every
      // composite-PK join table, message_levels) it raises a hard error
      // instead of returning NULL, which a SQL-side `IF seq_name IS NOT
      // NULL` guard never gets a chance to catch.
      if (tableColumns?.has("id")) {
        await client.query(
          `DO $$
           DECLARE
             seq_name text := pg_get_serial_sequence('${table}', 'id');
             max_id bigint;
           BEGIN
             IF seq_name IS NOT NULL THEN
               EXECUTE format('SELECT COALESCE(MAX(id), 0) FROM %I', '${table}') INTO max_id;
               PERFORM setval(seq_name, GREATEST(max_id, 1), max_id > 0);
             END IF;
           END $$;`,
        );
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Clear Logs - the 3 log_* tables only, never touches CONFIG_TABLES.
 *
 * Found live (2026-08-30, reported as "Clear Logs doesn't work"): the
 * header's own "unread warnings/errors" badges are NOT derived from
 * `log_messages` on every render - they're cached counters in Redis
 * (processMessages.ts's `wem:unread:*` keys, incrementally maintained by
 * `bumpUnreadCount()` on every hide/create). A raw TRUNCATE here deletes
 * the rows but never touches those counters, so the badges kept showing
 * their pre-clear numbers even though the table was genuinely empty -
 * looked exactly like the whole action silently did nothing.
 * `initUnreadCounts()` resyncs them from the table's real (now empty)
 * state, the same call server.ts already makes once at boot. */
export async function clearLogTables(): Promise<void> {
  await pool.query(`TRUNCATE ${LOG_TABLES.join(", ")} RESTART IDENTITY`);
  await initUnreadCounts();
}
