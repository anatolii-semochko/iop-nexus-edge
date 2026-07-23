// Live runtime state for processes (AGENTS.md section 10 - the platform's
// first orchestration step). Same split as dualDevicesModel.ts: the
// `processes` Postgres table (apps/api/migrations) is the design-time
// registry - name, group, type, kind, config - this module is the
// currently-in-effect state that changes on every action/tick, not
// something you'd persist as configuration.

import { publishProcessEvent } from "./messaging.js";
import { redis } from "./redis.js";

export type ProcessStatus = "on" | "off";

function keysFor(processId: number) {
  return {
    status: `process:${processId}:status`,
    critical: `process:${processId}:critical`,
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
