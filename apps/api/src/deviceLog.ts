// Time series of every readOnly (sensor) device value published via
// dualDevicesModel.publishReading (AGENTS.md section 22) - append-only,
// no filtering yet (logs everything unconditionally). Table `log_device`
// (renamed from `sensor_reading_logs`, to-do.txt's 2026-07-27 Device/Node
// refactor) - no `resource` column anymore: a Device is atomic, exactly
// one value, so `device_id` alone already says what this reading is.

import { logger } from "./logger.js";
import { pool } from "./db.js";

export interface DeviceLogEntry {
  deviceId: number;
  value: unknown;
  source: string;
}

// Best-effort, same principle as messaging.ts's publish() - a logging
// failure must never break the actual reading pipeline it's observing.
export async function logReading(entry: DeviceLogEntry): Promise<void> {
  try {
    await pool.query(`INSERT INTO log_device (device_id, value, source) VALUES ($1, $2, $3)`, [
      entry.deviceId,
      entry.value,
      entry.source,
    ]);
  } catch (err) {
    logger.warn({ err, deviceId: entry.deviceId }, "failed to write log_device entry");
  }
}

export interface DeviceLogListItem {
  id: number;
  device_id: number | null;
  // Null when `device_id` is null (the device was later deleted - ON
  // DELETE SET NULL, same as the column itself) - the log entry survives,
  // just without a name to show.
  device_name: string | null;
  value: unknown;
  source: string;
  created_at: string;
}

export interface ListDeviceLogsParams {
  deviceId?: number;
  search?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

/**
 * Server-side paginated feed for the Logs page's devices tab (AGENTS.md
 * section 29). `search` matches the device name - the reading's own value
 * has no separate resource label to search by anymore.
 */
export async function listDeviceLogs(params: ListDeviceLogsParams): Promise<{ items: DeviceLogListItem[]; total: number }> {
  const { deviceId, search, from, to, page, pageSize } = params;
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (deviceId !== undefined) {
    values.push(deviceId);
    conditions.push(`l.device_id = $${values.length}`);
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
    pool.query<DeviceLogListItem>(
      `SELECT l.id, l.device_id, d.name AS device_name, l.value, l.source, l.created_at
       FROM log_device l
       LEFT JOIN devices d ON d.id = l.device_id
       WHERE ${where}
       ORDER BY l.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...values, pageSize, offset],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM log_device l LEFT JOIN devices d ON d.id = l.device_id WHERE ${where}`,
      values,
    ),
  ]);

  return { items, total: Number(countRows[0].count) };
}
