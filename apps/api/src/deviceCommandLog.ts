// Audit trail of every write sent through the Devices API's four mutating
// endpoints (AGENTS.md section 22) - append-only, no read/query surface
// yet (no UI page to browse this exists), just the write side for now.

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
