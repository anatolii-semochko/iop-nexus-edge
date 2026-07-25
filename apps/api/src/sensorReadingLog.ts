// Time series of every readOnly (sensor) resource value published via
// dualDevicesModel.publishReading (AGENTS.md section 22) - append-only,
// no filtering yet (logs everything unconditionally), no read/query
// surface yet either.

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
