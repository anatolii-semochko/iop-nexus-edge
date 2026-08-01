// Audit trail of every command issued through the Devices API's mutating
// endpoints (AGENTS.md section 22) - append-only. Table `log_command`
// (renamed from `device_command_logs`, AGENTS_TO_DO.md's 2026-07-27 Device/Node
// refactor). Widened (2026-08-01) to cover process actions (ON/OFF,
// config changes) alongside device writes, and to record WHO issued each
// command (`actor_user_id`) rather than the previously meaningless-in-
// practice `source` string (always literally "api") - see migration
// 1690000000039. The orchestrator IS the "system" user (routes/users.ts's
// own protected service account) for this purpose, not a separate
// synthetic actor type - migration 1690000000040 retired that distinction.

import { logger } from "./logger.js";
import { pool } from "./db.js";

export type DeviceCommandAction = "write" | "auto" | "release" | "simulate" | "on" | "off" | "config";

export interface CommandLogEntry {
  // Exactly one of deviceId/processId in practice (device actions vs
  // process actions) - not enforced by a DB constraint, since a later
  // delete of either must be free to null this out without invalidating
  // the row (see migration 1690000000039's own comment).
  deviceId?: number;
  processId?: number;
  action: DeviceCommandAction;
  // Absent for "release"/"on"/"off" - those carry no meaningful body.
  value?: unknown;
  source: string;
  actorUserId: number;
}

// Best-effort, same principle as messaging.ts's publish() - a logging
// failure must never break the actual command it's observing.
export async function logCommand(entry: CommandLogEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO log_command (device_id, process_id, action, value, source, actor_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entry.deviceId ?? null, entry.processId ?? null, entry.action, entry.value ?? null, entry.source, entry.actorUserId],
    );
  } catch (err) {
    logger.warn({ err, deviceId: entry.deviceId, processId: entry.processId, action: entry.action }, "failed to write log_command entry");
  }
}

let systemActorUserIdCache: number | null = null;

/**
 * The "system" user's id (routes/users.ts's protected, non-deletable
 * service account, seeded by migration 1690000000009) - every
 * orchestrator-issued command attributes to this real user row
 * (AGENTS_TO_DO.md, 2026-08-01: "system... Це і є оркестратор"). Cached in
 * memory after the first successful lookup (this id never changes once
 * seeded) rather than queried on every single tick's write - only caches
 * on success, so a lookup failure (e.g. mid-migration at boot) doesn't
 * wedge every later call into repeating the same error forever.
 */
export async function getSystemActorUserId(): Promise<number> {
  if (systemActorUserIdCache !== null) return systemActorUserIdCache;
  const result = await pool.query<{ id: number }>("SELECT id FROM users WHERE username = 'system'");
  if (!result.rows[0]) {
    throw new Error("system user not found");
  }
  systemActorUserIdCache = result.rows[0].id;
  return systemActorUserIdCache;
}

export interface CommandLogActorUser {
  id: number;
  display_name: string | null;
  username: string;
  avatar_path: string | null;
}

export interface CommandLogListItem {
  id: number;
  device_id: number | null;
  // Null when the referenced row is null (device/process later deleted -
  // ON DELETE SET NULL) - the log entry survives, just without a name to
  // show. Exactly one of device_name/process_name is set for any given
  // row in practice.
  device_name: string | null;
  process_id: number | null;
  process_name: string | null;
  action: DeviceCommandAction;
  value: unknown;
  source: string;
  // Null only for a legacy row predating actor_user_id existing at all
  // (migration 1690000000039's backfill had no way to know which human
  // issued an old write/release/simulate command - only that it was one).
  actor_user: CommandLogActorUser | null;
  created_at: string;
}

interface CommandLogRawRow {
  id: number;
  device_id: number | null;
  device_name: string | null;
  process_id: number | null;
  process_name: string | null;
  action: DeviceCommandAction;
  value: unknown;
  source: string;
  actor_user_id: number | null;
  actor_display_name: string | null;
  actor_username: string | null;
  actor_avatar_path: string | null;
  created_at: string;
}

export interface ListCommandLogsParams {
  deviceId?: number;
  action?: DeviceCommandAction;
  actorUserId?: number;
  search?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

/**
 * Server-side paginated feed for the Logs page's Commands tab (AGENTS.md
 * section 29/36). `search` matches either the device or the process name -
 * a row targets one or the other, never both.
 */
export async function listCommandLogs(params: ListCommandLogsParams): Promise<{ items: CommandLogListItem[]; total: number }> {
  const { deviceId, action, actorUserId, search, from, to, page, pageSize } = params;
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (deviceId !== undefined) {
    values.push(deviceId);
    conditions.push(`l.device_id = $${values.length}`);
  }
  if (action) {
    values.push(action);
    conditions.push(`l.action = $${values.length}`);
  }
  if (actorUserId !== undefined) {
    values.push(actorUserId);
    conditions.push(`l.actor_user_id = $${values.length}`);
  }
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`(d.name ILIKE $${values.length} OR p.name ILIKE $${values.length})`);
  }
  if (from) {
    values.push(from);
    conditions.push(`l.created_at >= $${values.length}`);
  }
  if (to) {
    values.push(to);
    conditions.push(`l.created_at <= $${values.length}`);
  }
  const where = conditions.length > 0 ? conditions.join(" AND ") : "TRUE";

  const offset = (page - 1) * pageSize;
  const limitParam = values.length + 1;
  const offsetParam = values.length + 2;

  const FROM_CLAUSE = `
    FROM log_command l
    LEFT JOIN devices d ON d.id = l.device_id
    LEFT JOIN processes p ON p.id = l.process_id
    LEFT JOIN users u ON u.id = l.actor_user_id
  `;

  const [{ rows: items }, { rows: countRows }] = await Promise.all([
    pool.query<CommandLogRawRow>(
      `SELECT l.id, l.device_id, d.name AS device_name, l.process_id, p.name AS process_name,
              l.action, l.value, l.source, l.created_at,
              u.id AS actor_user_id, u.display_name AS actor_display_name,
              u.username AS actor_username, u.avatar_path AS actor_avatar_path
       ${FROM_CLAUSE}
       WHERE ${where}
       ORDER BY l.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...values, pageSize, offset],
    ),
    pool.query<{ count: string }>(`SELECT COUNT(*) ${FROM_CLAUSE} WHERE ${where}`, values),
  ]);

  return {
    items: items.map((row) => ({
      id: row.id,
      device_id: row.device_id,
      device_name: row.device_name,
      process_id: row.process_id,
      process_name: row.process_name,
      action: row.action,
      value: row.value,
      source: row.source,
      // `actor_username` is only null when the LEFT JOIN found no match
      // (actor_user_id itself null) - the guard above already excludes
      // that case, `users.username` is NOT NULL whenever a row did match.
      actor_user: row.actor_user_id
        ? {
            id: row.actor_user_id,
            display_name: row.actor_display_name,
            username: row.actor_username as string,
            avatar_path: row.actor_avatar_path,
          }
        : null,
      created_at: row.created_at,
    })),
    total: Number(countRows[0].count),
  };
}
