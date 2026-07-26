// Live runtime state for processes (AGENTS.md section 10 - the platform's
// first orchestration step; section 24 - the consolidated public-state
// broadcast). Same split as dualDevicesModel.ts: the `processes` Postgres
// table (apps/api/migrations) is the design-time registry - name, group,
// type, kind, config - this module is the currently-in-effect state that
// changes on every action/tick, not something you'd persist as
// configuration.
//
// Every dynamic field for a process (status/critical/warning/metrics/active
// messages) lives in ONE Redis hash per process (`process:{id}:public`),
// not five independent keys as before section 24's rework - this is what
// lets processBroadcast.ts assemble a process's complete public state with
// one HGETALL instead of five round trips, and is the single source of
// truth both GET /processes (routes/processes.ts's withLiveState) and the
// fleet-wide broadcast (processBroadcast.ts) read from. This module owns
// the shape of that public state - it does not flow through messaging.ts
// (RabbitMQ device-domain publishing only, section 24) at all.

import { processStateEvents } from "./processStateEvents.js";
import { redis } from "./redis.js";

export type ProcessStatus = "on" | "off";

export interface ProcessMetrics {
  cpu: number;
  ram: number;
  disk: number;
}

export interface ProcessPublicMessage {
  id: number;
  type: "warning" | "error" | "message";
  level: number;
  code: string;
  text: string;
  hidden: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProcessPublicState {
  status: ProcessStatus;
  critical: boolean;
  warning: boolean;
  metrics?: ProcessMetrics;
  messages: ProcessPublicMessage[];
  updatedAt?: string;
}

function key(processId: number): string {
  return `process:${processId}:public`;
}

async function touch(processId: number, fields: Record<string, string>): Promise<void> {
  await redis.hset(key(processId), { ...fields, updatedAt: new Date().toISOString() });
}

/** A controllable process starts "on" (actively controlling) until
 * something explicitly turns it off - no field yet means "on", not "off". */
export async function getStatus(processId: number): Promise<ProcessStatus> {
  const raw = await redis.hget(key(processId), "status");
  return raw === "off" ? "off" : "on";
}

// Timer-only (AGENTS.md section 24) - a status flip is already reflected
// immediately in whatever REST response the UI action that caused it is
// driven from; it doesn't need the same out-of-band urgent broadcast as
// critical/warning/new-messages.
export async function setStatus(processId: number, status: ProcessStatus, source: string): Promise<void> {
  const current = await getStatus(processId);
  if (current === status) return;
  await touch(processId, { status });
}

export async function getCritical(processId: number): Promise<boolean> {
  return (await redis.hget(key(processId), "critical")) === "true";
}

/** No-op (and no broadcast) if the flag is already at this value - the
 * orchestrator's tick loop calls this every second regardless of whether
 * anything actually changed, and a flag flipping every tick when nothing
 * changed would be a misleading flood. */
export async function setCritical(processId: number, critical: boolean, source: string): Promise<void> {
  const current = await getCritical(processId);
  if (current === critical) return;

  await touch(processId, { critical: String(critical) });
  processStateEvents.emit("urgent", { reason: "critical", processId, source });
}

export async function getWarning(processId: number): Promise<boolean> {
  return (await redis.hget(key(processId), "warning")) === "true";
}

/** Same shape as setCritical - a less severe row highlight (yellow, not
 * red - AGENTS.md section 21) for a resource-monitor metric past its warn
 * threshold but not yet past its error one. */
export async function setWarning(processId: number, warning: boolean, source: string): Promise<void> {
  const current = await getWarning(processId);
  if (current === warning) return;

  await touch(processId, { warning: String(warning) });
  processStateEvents.emit("urgent", { reason: "warning", processId, source });
}

export async function getMetrics(processId: number): Promise<ProcessMetrics | undefined> {
  const raw = await redis.hget(key(processId), "metrics");
  return raw ? (JSON.parse(raw) as ProcessMetrics) : undefined;
}

// Unlike setStatus/setCritical/setWarning, this writes unconditionally on
// every call, not just on an actual change - the orchestrator already calls
// this exactly once per tick (1s). Timer-only, same as setStatus - a
// metrics reading a few seconds stale on the bus is not "urgent" the way a
// fresh critical/warning transition is; the periodic broadcast picks it up
// on its own cadence (PROCESS_STATE_BROADCAST_INTERVAL_MS).
export async function setMetrics(processId: number, metrics: ProcessMetrics, source: string): Promise<void> {
  await touch(processId, { metrics: JSON.stringify(metrics) });
}

// Called by processMessages.ts after every reconciliation - keeps this
// process's active-message list inside the same public-state hash as
// everything else, so the broadcast assembles it with one HGETALL instead
// of a Postgres round trip per process per broadcast tick. `urgent` is true
// only when the reconciliation actually inserted a brand-new active entry
// (not a text/level update to an existing one, not a resolve, not a
// dismiss) - see processMessages.syncActiveMessages/setHidden.
export async function setActiveMessages(
  processId: number,
  messages: ProcessPublicMessage[],
  urgent: boolean,
  source: string,
): Promise<void> {
  await touch(processId, { messages: JSON.stringify(messages) });
  if (urgent) {
    processStateEvents.emit("urgent", { reason: "messages", processId, source });
  }
}

/**
 * Full public state for one process, straight off its `process:{id}:public`
 * hash - the read side processBroadcast.ts's assembly loop calls once per
 * process per broadcast. `status` always resolves to "on"/"off" here
 * regardless of process type; whether a permanent process's status is
 * actually meaningful (it isn't - AGENTS.md section 10) is a Postgres-type
 * decision the caller applies on top, same as GET /processes' withLiveState
 * already does.
 */
export async function getPublicState(processId: number): Promise<ProcessPublicState> {
  const raw = await redis.hgetall(key(processId));
  return {
    status: raw.status === "off" ? "off" : "on",
    critical: raw.critical === "true",
    warning: raw.warning === "true",
    metrics: raw.metrics ? (JSON.parse(raw.metrics) as ProcessMetrics) : undefined,
    messages: raw.messages ? (JSON.parse(raw.messages) as ProcessPublicMessage[]) : [],
    updatedAt: raw.updatedAt,
  };
}
