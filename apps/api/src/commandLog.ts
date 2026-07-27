// Audit trail of every write sent through the Devices API's four mutating
// endpoints (AGENTS.md section 22) - append-only. Table `log_command`
// (renamed from `device_command_logs`, to-do.txt's 2026-07-27 Device/Node
// refactor) - no `resource` column anymore: a Device is atomic, exactly
// one value, so `device_id` alone already says what was written.

import { logger } from "./logger.js";
import { pool } from "./db.js";

export type DeviceCommandAction = "write" | "auto" | "release" | "simulate";

export interface CommandLogEntry {
  deviceId: number;
  action: DeviceCommandAction;
  // Absent for "release" - it has no request body.
  value?: unknown;
  source: string;
}

// Best-effort, same principle as messaging.ts's publish() - a logging
// failure must never break the actual device command it's observing.
export async function logCommand(entry: CommandLogEntry): Promise<void> {
  try {
    await pool.query(`INSERT INTO log_command (device_id, action, value, source) VALUES ($1, $2, $3, $4)`, [
      entry.deviceId,
      entry.action,
      entry.value ?? null,
      entry.source,
    ]);
  } catch (err) {
    logger.warn({ err, deviceId: entry.deviceId, action: entry.action }, "failed to write log_command entry");
  }
}

export interface CommandLogListItem {
  id: number;
  device_id: number | null;
  // Null when `device_id` is null (the device was later deleted - ON
  // DELETE SET NULL, same as the column itself) - the log entry survives,
  // just without a name to show.
  device_name: string | null;
  action: DeviceCommandAction;
  value: unknown;
  source: string;
  created_at: string;
}

export interface ListCommandLogsParams {
  deviceId?: number;
  action?: DeviceCommandAction;
  search?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

/**
 * Server-side paginated feed for the Logs page's commands tab (AGENTS.md
 * section 29). `search` matches the device name - a command has no
 * separate resource label to search by anymore.
 */
export async function listCommandLogs(params: ListCommandLogsParams): Promise<{ items: CommandLogListItem[]; total: number }> {
  const { deviceId, action, search, from, to, page, pageSize } = params;
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
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`d.name ILIKE $${values.length}`);
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

  const [{ rows: items }, { rows: countRows }] = await Promise.all([
    pool.query<CommandLogListItem>(
      `SELECT l.id, l.device_id, d.name AS device_name, l.action, l.value, l.source, l.created_at
       FROM log_command l
       LEFT JOIN devices d ON d.id = l.device_id
       WHERE ${where}
       ORDER BY l.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...values, pageSize, offset],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM log_command l LEFT JOIN devices d ON d.id = l.device_id WHERE ${where}`,
      values,
    ),
  ]);

  return { items, total: Number(countRows[0].count) };
}
