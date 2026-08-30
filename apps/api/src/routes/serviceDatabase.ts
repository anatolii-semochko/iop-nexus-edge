import type { MultipartFile } from "@fastify/multipart";
import type { FastifyInstance } from "fastify";

import { requireAdmin } from "../auth.js";
import { logCommand } from "../commandLog.js";
import { config } from "../config.js";
import { pool } from "../db.js";
import {
  applyStampDump,
  buildLogsDump,
  buildStampDump,
  clearLogTables,
  CONFIG_TABLES,
  createStampFile,
  deleteStampFile,
  LOG_TABLES,
  listStampFiles,
  readStampFile,
  StampCompatibilityError,
  type StampDump,
} from "../systemStamps.js";

// Service->Database (AGENTS_TO_DO.md, 2026-08-30) - admin-only, same
// requireAdmin preHandler pattern as routes/service.ts/users.ts.

interface TableSizeRow {
  table_name: string;
  bytes: string;
}

async function tableSizes(tables: readonly string[]): Promise<Record<string, number>> {
  if (tables.length === 0) return {};
  const { rows } = await pool.query<TableSizeRow>(
    `SELECT relname AS table_name, pg_total_relation_size(relid) AS bytes
     FROM pg_catalog.pg_statio_user_tables
     WHERE relname = ANY($1)`,
    [tables as unknown as string[]],
  );
  const sizes: Record<string, number> = {};
  for (const row of rows) sizes[row.table_name] = Number(row.bytes);
  return sizes;
}

// Applying an uploaded/malformed dump can throw for all sorts of reasons
// (JSON.parse failure, a StampCompatibilityError, a raw Postgres error if
// somehow a row still doesn't match) - one place to turn any of those into
// the same 400 response shape, rather than repeating this at each call site.
async function runApply(dump: StampDump): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  try {
    await applyStampDump(dump);
    return { ok: true };
  } catch (err) {
    if (err instanceof StampCompatibilityError) {
      return { ok: false, status: 409, error: err.message };
    }
    throw err;
  }
}

export async function serviceDatabaseRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAdmin);

  app.get("/service/database/stats", async () => {
    const [configSizes, logSizes] = await Promise.all([tableSizes(CONFIG_TABLES), tableSizes(LOG_TABLES)]);
    const configBytes = Object.values(configSizes).reduce((a, b) => a + b, 0);
    const logsBytes = Object.values(logSizes).reduce((a, b) => a + b, 0);
    const { rows: totalRows } = await pool.query<{ bytes: string }>(
      "SELECT pg_database_size(current_database()) AS bytes",
    );
    const totalBytes = Number(totalRows[0].bytes);
    return {
      configBytes,
      logsBytes,
      // Everything pg_database_size counts that isn't one of our own
      // config/log tables (library_categories/items, pgmigrations, index/
      // catalog overhead) - shown as a third "other" slice rather than
      // silently folded into config, which would overstate it.
      otherBytes: Math.max(0, totalBytes - configBytes - logsBytes),
      totalBytes,
      tables: [
        ...Object.entries(configSizes).map(([name, bytes]) => ({ name, bytes, category: "config" as const })),
        ...Object.entries(logSizes).map(([name, bytes]) => ({ name, bytes, category: "logs" as const })),
      ],
    };
  });

  app.get("/service/database/stamps", async () => {
    return { stamps: await listStampFiles() };
  });

  app.post<{ Body: { name?: string } }>("/service/database/stamps", async (request, reply) => {
    const name = request.body?.name?.trim() || new Date().toISOString();
    const entry = await createStampFile(name);
    return reply.code(201).send(entry);
  });

  app.delete<{ Params: { filename: string } }>("/service/database/stamps/:filename", async (request, reply) => {
    try {
      await deleteStampFile(request.params.filename);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return reply.code(404).send({ error: "stamp not found" });
      }
      throw err;
    }
    return reply.code(204).send();
  });

  app.post<{ Params: { filename: string } }>("/service/database/stamps/:filename/apply", async (request, reply) => {
    let dump: StampDump;
    try {
      dump = await readStampFile(request.params.filename);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return reply.code(404).send({ error: "stamp not found" });
      }
      throw err;
    }
    const result = await runApply(dump);
    await logCommand({
      action: "set-state",
      value: { source: "apply", filename: request.params.filename, ok: result.ok },
      source: "service-database",
      actorUserId: request.user.sub,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return { ok: true };
  });

  // Ad-hoc dump of the LIVE database, streamed straight to the client -
  // deliberately never touches disk server-side (AGENTS_TO_DO.md, 2026-08-30:
  // "Download робить дамп користувачу, не зберігає на сервері"), unlike
  // Save State above.
  app.get("/service/database/download", async (request, reply) => {
    const dump = await buildStampDump(`download-${new Date().toISOString()}`);
    reply.header("Content-Disposition", `attachment; filename="${dump.projectName}-${dump.createdAt}.json"`);
    reply.type("application/json");
    return dump;
  });

  // Ad-hoc dump of the 3 log_* tables, streamed straight to the client -
  // same "never touches disk server-side" shape as /download above, just
  // for logs instead of config (AGENTS_TO_DO.md, 2026-08-30: "Логи
  // Download" was its own separate spec point from the config Download/
  // Upload pair).
  app.get("/service/database/download-logs", async (request, reply) => {
    const dump = await buildLogsDump();
    reply.header("Content-Disposition", `attachment; filename="${dump.projectName}-logs-${dump.createdAt}.json"`);
    reply.type("application/json");
    return dump;
  });

  app.post("/service/database/upload", async (request, reply) => {
    const file: MultipartFile | undefined = await request.file({
      limits: { fileSize: config.systemStamps.maxUploadSizeBytes },
    });
    if (!file) return reply.code(400).send({ error: "a stamp file is required" });

    const buffer = await file.toBuffer();
    // Same truncated-not-thrown caveat as the avatar upload route.
    if (file.file.truncated) {
      return reply.code(413).send({ error: "uploaded file exceeds the maximum allowed size" });
    }
    let dump: StampDump;
    try {
      dump = JSON.parse(buffer.toString("utf-8")) as StampDump;
    } catch {
      return reply.code(400).send({ error: "uploaded file is not valid JSON" });
    }

    const result = await runApply(dump);
    await logCommand({
      action: "set-state",
      value: { source: "upload", filename: file.filename, ok: result.ok },
      source: "service-database",
      actorUserId: request.user.sub,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return { ok: true };
  });

  app.delete("/service/database/logs", async (request, reply) => {
    await clearLogTables();
    await logCommand({
      action: "clear-logs",
      source: "service-database",
      actorUserId: request.user.sub,
    });
    return reply.code(204).send();
  });
}
