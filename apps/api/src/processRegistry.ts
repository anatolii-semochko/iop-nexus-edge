// Live runtime state for processes (AGENTS.md section 10 - the platform's
// first orchestration step). Same split as dualDevicesModel.ts: the
// `processes` Postgres table (apps/api/migrations) is the design-time
// registry - name, group, type, kind, config - this module is the
// currently-in-effect state that changes on every action/tick, not
// something you'd persist as configuration.

import { publishProcessEvent } from "./messaging.js";
import { redis } from "./redis.js";

export type ProcessStatus = "on" | "off";

export interface ProcessMetrics {
  cpu: number;
  ram: number;
  disk: number;
}

function keysFor(processId: number) {
  return {
    status: `process:${processId}:status`,
    critical: `process:${processId}:critical`,
    warning: `process:${processId}:warning`,
    metrics: `process:${processId}:metrics`,
  };
}

/** A controllable process starts "on" (actively controlling) until
 * something explicitly turns it off - no key yet means "on", not "off". */
export async function getStatus(processId: number): Promise<ProcessStatus> {
  const raw = await redis.get(keysFor(processId).status);
  return raw === "off" ? "off" : "on";
}

export async function setStatus(processId: number, status: ProcessStatus, source: string): Promise<void> {
  const current = await getStatus(processId);
  if (current === status) return;

  await redis.set(keysFor(processId).status, status);
  await publishProcessEvent({
    domain: "process",
    entityId: processId,
    field: "status",
    value: status,
    timestamp: new Date().toISOString(),
    source,
  });
}

export async function getCritical(processId: number): Promise<boolean> {
  return (await redis.get(keysFor(processId).critical)) === "true";
}

/** No-op (and no publish) if the flag is already at this value - the
 * orchestrator's tick loop calls this every second regardless of whether
 * anything actually changed, and a flag flipping every tick when nothing
 * changed would be a misleading flood on the message bus. */
export async function setCritical(processId: number, critical: boolean, source: string): Promise<void> {
  const current = await getCritical(processId);
  if (current === critical) return;

  await redis.set(keysFor(processId).critical, String(critical));
  await publishProcessEvent({
    domain: "process",
    entityId: processId,
    field: "critical",
    value: critical,
    timestamp: new Date().toISOString(),
    source,
  });
}

export async function getWarning(processId: number): Promise<boolean> {
  return (await redis.get(keysFor(processId).warning)) === "true";
}

/** Same shape as setCritical - a less severe row highlight (yellow, not
 * red - AGENTS.md section 21) for a resource-monitor metric past its warn
 * threshold but not yet past its error one. */
export async function setWarning(processId: number, warning: boolean, source: string): Promise<void> {
  const current = await getWarning(processId);
  if (current === warning) return;

  await redis.set(keysFor(processId).warning, String(warning));
  await publishProcessEvent({
    domain: "process",
    entityId: processId,
    field: "warning",
    value: warning,
    timestamp: new Date().toISOString(),
    source,
  });
}

export async function getMetrics(processId: number): Promise<ProcessMetrics | undefined> {
  const raw = await redis.get(keysFor(processId).metrics);
  return raw ? (JSON.parse(raw) as ProcessMetrics) : undefined;
}

// Unlike setStatus/setCritical/setWarning, this publishes unconditionally
// on every call, not just on an actual change - the orchestrator already
// calls this exactly once per tick (1s), so "publish once a second" falls
// out of that for free without any extra throttling logic here. This is
// deliberate, not an oversight: continuous numeric telemetry is exactly
// what a live dashboard subscribing to this bus needs to stay current,
// same as any other "push state as it's produced" feed (AGENTS.md
// section 21) - there is no separate polling path for this data anymore.
export async function setMetrics(processId: number, metrics: ProcessMetrics, source: string): Promise<void> {
  await redis.set(keysFor(processId).metrics, JSON.stringify(metrics));
  await publishProcessEvent({
    domain: "process",
    entityId: processId,
    field: "metrics",
    value: metrics,
    timestamp: new Date().toISOString(),
    source,
  });
}
