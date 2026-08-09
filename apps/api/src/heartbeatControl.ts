// Heartbeating (AGENTS.md's Heartbeating Control section) - config lives
// on each entity's own table (`heartbeat_control` jsonb column, migration
// ..._add-heartbeat-control-to-entities), this module is the cross-entity
// service layer: the mixed processes/devices/nodes list the "Heartbeating
// Control" process's UI panel reads, the update path for its user-editable
// warning/error thresholds, and the Redis-backed runtime on/off + last-seen
// state (config is Postgres/design-time, this is Redis/live - same split
// as everywhere else in this app).
//
// Real staleness *detection* (comparing last-seen against the configured
// thresholds and raising WEM) is NOT here - that's
// apps/orchestrator/src/processes/heartbeatControl.ts, since only the
// orchestrator's tick loop knows what "a tick" actually is. This module
// only stores/serves the raw ingredients.

import { pool } from "./db.js";
import { redis } from "./redis.js";

export type EntityType = "process" | "device" | "node";

const TABLE_BY_TYPE: Record<EntityType, string> = {
  process: "processes",
  device: "devices",
  node: "nodes",
};

export interface HeartbeatThreshold {
  numberSkippedTicks: number;
  level: number;
}

export interface HeartbeatControlConfig {
  // System-set (AGENTS.md) - never accepted from updateHeartbeatControl's
  // own body, only ever set by a migration/seed for a given entity.
  stoppable: boolean;
  warning: HeartbeatThreshold | null;
  error: HeartbeatThreshold | null;
}

export interface HeartbeatControlEntry {
  type: EntityType;
  id: number;
  name: string;
  heartbeatControl: HeartbeatControlConfig;
  // Live (Redis) - whether monitoring is currently paused. Always false
  // for a non-stoppable entity; the API refuses to ever set it true there.
  stopped: boolean;
  // Live (Redis) - only ever populated for processes today (the only
  // entity type with a real heartbeat producer so far - AGENTS.md).
  lastSeenAt: string | null;
}

function stoppedKey(type: EntityType, id: number): string {
  return `heartbeat:${type}:${id}:stopped`;
}

function lastSeenKey(type: EntityType, id: number): string {
  return `heartbeat:${type}:${id}:lastSeen`;
}

function testSimulateFailureKey(processId: number): string {
  return `heartbeat:test:${processId}:simulateFailure`;
}

// Bespoke internal state for the "heartbeat-control-test" process kind
// only (AGENTS.md's Heartbeating Control section) - deliberately separate
// from `isMonitoringStopped`/`setMonitoringStopped` above, which pauses
// whether "Heartbeating Control" bothers *checking* an entity at all.
// This flag instead makes the test process's own orchestrator runner
// throw (a genuinely dead heartbeat, not a paused check) - confirmed with
// the user after an earlier draft wrongly reused the generic process
// ON/OFF status mechanism for this, which is a deliberately non-urgent,
// timer-only broadcast field and visibly lagged in the UI as a result.
export async function isTestSimulateFailure(processId: number): Promise<boolean> {
  return (await redis.get(testSimulateFailureKey(processId))) === "true";
}

export async function setTestSimulateFailure(processId: number, simulate: boolean): Promise<void> {
  if (simulate) {
    await redis.set(testSimulateFailureKey(processId), "true");
  } else {
    await redis.del(testSimulateFailureKey(processId));
  }
}

export async function isMonitoringStopped(type: EntityType, id: number): Promise<boolean> {
  return (await redis.get(stoppedKey(type, id))) === "true";
}

/** Rejects (throws) if the entity isn't `stoppable` - checked here, not just
 * trusted from the caller, since this is the one place that can actually
 * enforce it against the entity's own persisted config. */
export async function setMonitoringStopped(type: EntityType, id: number, stopped: boolean): Promise<void> {
  const { rows } = await pool.query<{ heartbeat_control: HeartbeatControlConfig }>(
    `SELECT heartbeat_control FROM ${TABLE_BY_TYPE[type]} WHERE id = $1`,
    [id],
  );
  const config = rows[0]?.heartbeat_control;
  if (!config) throw new NotFoundError();
  if (!config.stoppable && stopped) throw new NotStoppableError();

  if (stopped) {
    await redis.set(stoppedKey(type, id), "true");
  } else {
    await redis.del(stoppedKey(type, id));
  }
}

async function getLastSeenAt(type: EntityType, id: number): Promise<string | null> {
  const raw = await redis.get(lastSeenKey(type, id));
  return raw ? new Date(Number(raw)).toISOString() : null;
}

/** Fleet-wide heartbeat touch for processes - called once per orchestrator
 * tick with every process id whose runner completed this tick *without
 * throwing* (AGENTS.md). Deliberately a plain last-write-wins timestamp,
 * not a TTL-expiring key - the configured thresholds are in "number of
 * skipped ticks", which can be a much longer window than any single fixed
 * TTL could represent for both the warning and error tier at once (see
 * apps/orchestrator/src/processes/heartbeatControl.ts, which reads this
 * value and does the actual threshold comparison itself). */
export async function touchHeartbeats(processIds: number[]): Promise<void> {
  if (processIds.length === 0) return;
  const now = String(Date.now());
  const pipeline = redis.pipeline();
  for (const id of processIds) {
    pipeline.set(lastSeenKey("process", id), now);
  }
  await pipeline.exec();
}

export async function getProcessLastSeenAt(processId: number): Promise<string | null> {
  return getLastSeenAt("process", processId);
}

export async function getProcessHeartbeatStopped(processId: number): Promise<boolean> {
  return isMonitoringStopped("process", processId);
}

/** The node-side counterpart of touchHeartbeats above (AGENTS_TO_DO.md,
 * 2026-08-09 "НОДА КОНТРОЛЮ") - the first real heartbeat producer for a
 * node. Unlike a process (which self-reports "my own tick just ran"), a
 * physical node has no way to push into this API directly - its own
 * permanent process (apps/orchestrator/src/processes/controlNode.ts)
 * calls this once per tick, but only when that node's `Heartbeat` device
 * resource actually *changed* since the last tick (see that device
 * type's own contract.schema.ts for why a changed value, not just any
 * value, is what proves freshness against EdgeX's non-expiring CAN frame
 * cache).
 *
 * Also updates the legacy `nodes.last_heartbeat_at` column - present
 * since the original Node/Device scaffold and already rendered by
 * NodesList.jsx, but never written by anything until now (a real,
 * pre-existing gap, not introduced here) - a free correctness fix now
 * that a real producer exists, no separate migration needed since the
 * column already exists. */
export async function touchNodeHeartbeats(nodeIds: number[]): Promise<void> {
  if (nodeIds.length === 0) return;
  const now = String(Date.now());
  const pipeline = redis.pipeline();
  for (const id of nodeIds) {
    pipeline.set(lastSeenKey("node", id), now);
  }
  await pipeline.exec();
  await pool.query(
    `UPDATE nodes SET last_heartbeat_at = now() WHERE id = ANY($1::int[])`,
    [nodeIds],
  );
}

export async function getNodeLastSeenAt(nodeId: number): Promise<string | null> {
  return getLastSeenAt("node", nodeId);
}

export async function getNodeHeartbeatStopped(nodeId: number): Promise<boolean> {
  return isMonitoringStopped("node", nodeId);
}

interface EntityRow {
  id: number;
  name: string;
  heartbeat_control: HeartbeatControlConfig;
}

async function listEntities(type: EntityType): Promise<HeartbeatControlEntry[]> {
  const { rows } = await pool.query<EntityRow>(
    `SELECT id, name, heartbeat_control FROM ${TABLE_BY_TYPE[type]} ORDER BY name`,
  );
  return Promise.all(
    rows.map(async (row) => ({
      type,
      id: row.id,
      name: row.name,
      heartbeatControl: row.heartbeat_control,
      stopped: await isMonitoringStopped(type, row.id),
      // "device" has no real producer yet (AGENTS.md's Heartbeating
      // Control section) - "process" and "node" (2026-08-09, the
      // control-node's own Heartbeat device) both do.
      lastSeenAt: type === "process" || type === "node" ? await getLastSeenAt(type, row.id) : null,
    })),
  );
}

/** The combined list the "Heartbeating Control" process's UI panel reads -
 * one row per monitored entity across all three types, sorted by name
 * (matching the panel's own default sort, confirmed with the user). */
export async function listHeartbeatControls(): Promise<HeartbeatControlEntry[]> {
  const [processes, devices, nodes] = await Promise.all([
    listEntities("process"),
    listEntities("device"),
    listEntities("node"),
  ]);
  return [...processes, ...devices, ...nodes].sort((a, b) => a.name.localeCompare(b.name));
}

export class NotFoundError extends Error {}
export class NotStoppableError extends Error {}

/** UI-driven - only `warning`/`error` are ever accepted here, `stoppable`
 * is never part of this body at all (AGENTS.md: "system-set, not
 * UI-configurable"). */
export async function updateHeartbeatControl(
  type: EntityType,
  id: number,
  patch: { warning: HeartbeatThreshold | null; error: HeartbeatThreshold | null },
): Promise<HeartbeatControlConfig> {
  const { rows } = await pool.query<{ heartbeat_control: HeartbeatControlConfig }>(
    `UPDATE ${TABLE_BY_TYPE[type]}
     SET heartbeat_control = heartbeat_control || $1::jsonb
     WHERE id = $2
     RETURNING heartbeat_control`,
    [JSON.stringify({ warning: patch.warning, error: patch.error }), id],
  );
  const config = rows[0]?.heartbeat_control;
  if (!config) throw new NotFoundError();
  return config;
}
