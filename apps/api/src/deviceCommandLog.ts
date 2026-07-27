// Audit trail of every write sent through the Devices API's four mutating
// endpoints (AGENTS.md section 22) - append-only. Read/query surface added
// in section 29 for the Logs page's deviceCommands tab.

import { logger } from "./logger.js";
import { pool } from "./db.js";

export type DeviceCommandAction = "write" | "auto" | "release" | "simulate";

export interface DeviceCommandLogEntry {
  deviceId: number;
  resource: string;
  action: DeviceCommandAction;
  // Absent for "release" - it has no request body.
  value?: unknown;
  source: string;
}

// Best-effort, same principle as messaging.ts's publish() - a logging
// failure must never break the actual device command it's observing.
export async function logCommand(entry: DeviceCommandLogEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO device_command_logs (device_id, resource, action, value, source)
       VALUES ($1, $2, $3, $4, $5)`,
      [entry.deviceId, entry.resource, entry.action, entry.value ?? null, entry.source],
    );
  } catch (err) {
    logger.warn({ err, deviceId: entry.deviceId, resource: entry.resource, action: entry.action }, "failed to write device_command_logs entry");
  }
}

export interface DeviceCommandLogListItem {
  id: number;
  device_id: number | null;
  // Null when `device_id` is null (the device was later deleted - ON
  // DELETE SET NULL, same as the column itself) - the log entry survives,
  // just without a name to show.
  device_name: string | null;
  resource: string;
  action: DeviceCommandAction;
  value: unknown;
  source: string;
  created_at: string;
}

export interface ListDeviceCommandLogsParams {
  deviceId?: number;
  action?: DeviceCommandAction;
  search?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

/**
 * Server-side paginated feed for the Logs page's deviceCommands tab
 * (AGENTS.md section 29) - same shape/pagination approach as
 * processMessages.listProcessMessages, this table just had no read
 * surface at all until now.
 */
export async function listDeviceCommandLogs(
  params: ListDeviceCommandLogsParams,
): Promise<{ items: DeviceCommandLogListItem[]; total: number }> {
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
    conditions.push(`l.resource ILIKE $${values.length}`);
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
    pool.query<DeviceCommandLogListItem>(
      `SELECT l.id, l.device_id, d.name AS device_name, l.resource, l.action, l.value, l.source, l.created_at
       FROM device_command_logs l
       LEFT JOIN devices d ON d.id = l.device_id
       WHERE ${where}
       ORDER BY l.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...values, pageSize, offset],
    ),
    pool.query<{ count: string }>(`SELECT COUNT(*) FROM device_command_logs l WHERE ${where}`, values),
  ]);

  return { items, total: Number(countRows[0].count) };
}
