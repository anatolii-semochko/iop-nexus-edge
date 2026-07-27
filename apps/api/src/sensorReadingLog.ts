// Time series of every readOnly (sensor) resource value published via
// dualDevicesModel.publishReading (AGENTS.md section 22) - append-only,
// no filtering yet (logs everything unconditionally). Read/query surface
// added in section 29 for the Logs page's sensors tab.

import { logger } from "./logger.js";
import { pool } from "./db.js";

export interface SensorReadingLogEntry {
  deviceId: number;
  resource: string;
  value: unknown;
  source: string;
}

// Best-effort, same principle as messaging.ts's publish() - a logging
// failure must never break the actual reading pipeline it's observing.
export async function logReading(entry: SensorReadingLogEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO sensor_reading_logs (device_id, resource, value, source)
       VALUES ($1, $2, $3, $4)`,
      [entry.deviceId, entry.resource, entry.value, entry.source],
    );
  } catch (err) {
    logger.warn({ err, deviceId: entry.deviceId, resource: entry.resource }, "failed to write sensor_reading_logs entry");
  }
}

export interface SensorReadingLogListItem {
  id: number;
  device_id: number | null;
  device_name: string | null;
  resource: string;
  value: unknown;
  source: string;
  created_at: string;
}

export interface ListSensorReadingLogsParams {
  deviceId?: number;
  search?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

/**
 * Server-side paginated feed for the Logs page's sensors tab (AGENTS.md
 * section 29) - same shape/pagination approach as
 * deviceCommandLog.listDeviceCommandLogs.
 */
export async function listSensorReadingLogs(
  params: ListSensorReadingLogsParams,
): Promise<{ items: SensorReadingLogListItem[]; total: number }> {
  const { deviceId, search, from, to, page, pageSize } = params;
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (deviceId !== undefined) {
    values.push(deviceId);
    conditions.push(`l.device_id = $${values.length}`);
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
    pool.query<SensorReadingLogListItem>(
      `SELECT l.id, l.device_id, d.name AS device_name, l.resource, l.value, l.source, l.created_at
       FROM sensor_reading_logs l
       LEFT JOIN devices d ON d.id = l.device_id
       WHERE ${where}
       ORDER BY l.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...values, pageSize, offset],
    ),
    pool.query<{ count: string }>(`SELECT COUNT(*) FROM sensor_reading_logs l WHERE ${where}`, values),
  ]);

  return { items, total: Number(countRows[0].count) };
}
