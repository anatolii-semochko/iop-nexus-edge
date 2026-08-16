// Data Logger (AGENTS.md's Data Logger section, Heartbeating Control used
// as the architectural template - confirmed with the user before
// building this) - config lives on `devices` itself (`data_logger_control`
// jsonb column, migration ..._add-data-logger), this module is the
// service layer: the Devices-only list the "Data Logger" process's UI
// panel reads, the update path for its user-editable period/thresholds,
// and the Redis-backed runtime last-logged-at state (config is
// Postgres/design-time, this is Redis/live - same split as everywhere
// else in this app, including Heartbeating Control itself).
//
// Real overdue-value *detection* (comparing last-logged-at against the
// configured period/thresholds, actually writing to `log_device`, and
// raising WEM) is NOT here - that's
// apps/orchestrator/src/processes/dataLogger.ts, since only the
// orchestrator's tick loop knows what "a tick" actually is. This module
// only stores/serves the raw ingredients, same division of labor as
// heartbeatControl.ts.

import { pool } from "./db.js";
import { redis } from "./redis.js";

export interface DataLoggerThreshold {
  numberSkippedPeriods: number;
  level: number;
}

export interface DataLoggerControlConfig {
  // Derived server-side, never trusted verbatim from a client body -
  // forced false whenever periodSeconds is null (AGENTS.md: "може бути
  // порожнім - свічер OFF+disable").
  writeEnabled: boolean;
  periodSeconds: number | null;
  warning: DataLoggerThreshold | null;
  error: DataLoggerThreshold | null;
}

export interface DataLoggerControlEntry {
  id: number;
  name: string;
  dataLoggerControl: DataLoggerControlConfig;
  lastLoggedAt: string | null;
}

export interface DataLoggerSettings {
  errorWarningEnabled: boolean;
  tickLoggingEnabled: boolean;
}

function lastLoggedKey(deviceId: number): string {
  return `data-logger:${deviceId}:lastLoggedAt`;
}

async function getLastLoggedAt(deviceId: number): Promise<string | null> {
  const raw = await redis.get(lastLoggedKey(deviceId));
  return raw ? new Date(Number(raw)).toISOString() : null;
}

/** AGENTS_TO_DO.md, 2026-08-16 - moves the Devices list's own overdue/
 * staleness check (previously computed client-side, DevicesList.jsx)
 * server-side, mirroring nodeHeartbeatStaleness's own role for Nodes. A
 * pure function, deliberately - `readingOriginMs`/`nowMs` are both passed
 * in rather than read here, same reasoning as that function's own
 * request-time-only stance (no caching, always as fresh as whatever
 * reading triggered this call). */
export function computeOverdue(
  config: DataLoggerControlConfig,
  readingOriginMs: number | null,
  nowMs: number,
): { isOverdue: boolean; expiresAt: number | null } {
  const maxAgeMs =
    config.periodSeconds && config.error?.numberSkippedPeriods
      ? config.periodSeconds * config.error.numberSkippedPeriods * 1000
      : null;
  if (maxAgeMs === null || readingOriginMs === null) {
    return { isOverdue: false, expiresAt: null };
  }
  const expiresAt = readingOriginMs + maxAgeMs;
  return { isOverdue: nowMs > expiresAt, expiresAt };
}


/** Called by the orchestrator runner right after it successfully writes a
 * `log_device` row for this device (AGENTS.md) - deliberately a plain
 * last-write-wins timestamp, not a TTL-expiring key, same reasoning as
 * Heartbeating Control's own `lastSeen`: the configured threshold is in
 * "number of skipped periods", a window a fixed TTL can't represent for
 * both the warning and error tier at once. */
export async function touchLastLoggedAt(deviceId: number): Promise<void> {
  await redis.set(lastLoggedKey(deviceId), String(Date.now()));
}

interface DeviceRow {
  id: number;
  name: string;
  data_logger_control: DataLoggerControlConfig;
}

/** The combined list the "Data Logger" process's UI panel reads - Devices
 * only (confirmed with the user: Nodes have no `value` of their own, a
 * Device is atomic - unlike Heartbeating Control's processes+devices+nodes
 * merge, there's nothing meaningful to log for a Node here), and further
 * narrowed to `readOnly` Devices only (confirmed with the user: a
 * writable actuator like active-buzzer-01 doesn't "provide data" the way
 * a sensor does - its value is a command this platform issued, not a
 * measurement - so it's excluded from this list entirely, not merely
 * left disabled). */
export async function listDataLoggerControls(): Promise<DataLoggerControlEntry[]> {
  const { rows } = await pool.query<DeviceRow>(
    `SELECT id, name, data_logger_control FROM devices
     WHERE (capabilities->>'readOnly')::boolean IS TRUE
     ORDER BY name`,
  );
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      name: row.name,
      dataLoggerControl: row.data_logger_control,
      lastLoggedAt: await getLastLoggedAt(row.id),
    })),
  );
}

export class NotFoundError extends Error {}

/** UI-driven - `periodSeconds`/`warning`/`error` only; `writeEnabled` is
 * never accepted directly here, it's derived: forced false when the patch
 * (or the row's already-stored value, if this call doesn't touch
 * `periodSeconds`) ends up with a null `periodSeconds`. */
export async function updateDataLoggerControl(
  deviceId: number,
  patch: { periodSeconds: number | null; warning: DataLoggerThreshold | null; error: DataLoggerThreshold | null },
): Promise<DataLoggerControlConfig> {
  const { rows } = await pool.query<{ data_logger_control: DataLoggerControlConfig }>(
    `UPDATE devices
     SET data_logger_control = CASE
       WHEN ($1::jsonb->>'periodSeconds') IS NULL
         THEN (data_logger_control || $1::jsonb) || '{"writeEnabled": false}'::jsonb
       ELSE data_logger_control || $1::jsonb
     END
     WHERE id = $2
     RETURNING data_logger_control`,
    [
      JSON.stringify({ periodSeconds: patch.periodSeconds, warning: patch.warning, error: patch.error }),
      deviceId,
    ],
  );
  const config = rows[0]?.data_logger_control;
  if (!config) throw new NotFoundError();
  return config;
}

export class NoPeriodConfiguredError extends Error {}

/** Runtime write/ignore switch (Postgres, not Redis - unlike Heartbeating
 * Control's pause/resume, this is a config-level decision, not a live
 * on/off - AGENTS.md). Refuses to enable when `periodSeconds` is null,
 * enforced here rather than just a disabled UI switch. */
export async function setWriteEnabled(deviceId: number, enabled: boolean): Promise<DataLoggerControlConfig> {
  const { rows } = await pool.query<{ data_logger_control: DataLoggerControlConfig }>(
    `SELECT data_logger_control FROM devices WHERE id = $1`,
    [deviceId],
  );
  const config = rows[0]?.data_logger_control;
  if (!config) throw new NotFoundError();
  if (enabled && config.periodSeconds === null) throw new NoPeriodConfiguredError();

  const { rows: updated } = await pool.query<{ data_logger_control: DataLoggerControlConfig }>(
    `UPDATE devices
     SET data_logger_control = data_logger_control || jsonb_build_object('writeEnabled', $1::boolean)
     WHERE id = $2
     RETURNING data_logger_control`,
    [enabled, deviceId],
  );
  return updated[0].data_logger_control;
}

/** The "Data Logger" process's own two global switches, kept in its
 * `config` (same place temperature-control keeps min/max) rather than a
 * new dedicated table - there are exactly two booleans and they belong to
 * this one process. */
export async function getSettings(): Promise<DataLoggerSettings> {
  const { rows } = await pool.query<{ config: DataLoggerSettings }>(
    `SELECT config FROM processes WHERE kind = 'data-logger'`,
  );
  const config = rows[0]?.config;
  if (!config) throw new NotFoundError();
  return config;
}

export async function updateSettings(patch: Partial<DataLoggerSettings>): Promise<DataLoggerSettings> {
  const { rows } = await pool.query<{ config: DataLoggerSettings }>(
    `UPDATE processes
     SET config = config || $1::jsonb
     WHERE kind = 'data-logger'
     RETURNING config`,
    [JSON.stringify(patch)],
  );
  const config = rows[0]?.config;
  if (!config) throw new NotFoundError();
  return config;
}
