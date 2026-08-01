// "heartbeat-control" process kind (AGENTS.md's Heartbeating Control
// section): the platform's own watchdog. Every tick, reads the whole
// fleet (the same `GET /processes` call index.ts's own tick() already
// makes, not a second one) and compares each monitored process's
// `heartbeatLastSeenAt` against its own configured warning/error
// skipped-tick thresholds, raising WEM entries under *this* process's own
// id - not the stale process's own id. That's deliberate, confirmed with
// the user: `process_messages` has no FK for devices/nodes at all, and a
// process whose own runner is genuinely broken can't reliably report its
// own staleness (detecting that is the entire point of an independent
// watchdog).
//
// Devices/nodes are not evaluated here at all yet - `GET /processes`
// never returns them, and there is no real heartbeat producer for either
// kind today (confirmed scope with the user: processes first, since they
// already have a natural 1s tick driver; devices/nodes get the config
// shape and UI now, real detection once a producer exists for them).
//
// Deliberately not skipping this process's own id in the loop below - if
// its own runner only sometimes throws (rather than every tick), letting
// it evaluate itself like any other entry gives it a narrow chance of
// noticing its own accumulated staleness on a tick it does succeed. If it
// stops running entirely, nothing (including this) can catch that from
// inside the orchestrator - a true external watchdog would be needed for
// that case, out of scope here.

import { apiClient, type MessageInput, type ProcessRecord } from "../apiClient.js";
import { TICK_INTERVAL_MS } from "../tickInterval.js";

// `null` - never seen a heartbeat yet (a fresh deploy, or a process kind
// with no runner) - deliberately not treated as "infinitely stale", same
// defensive stance as resourceMonitor.ts's own "no CPU sample yet" skip.
function skippedTicks(lastSeenAt: string | null): number | null {
  if (!lastSeenAt) return null;
  const elapsedMs = Date.now() - new Date(lastSeenAt).getTime();
  return Math.floor(elapsedMs / TICK_INTERVAL_MS);
}

export async function runHeartbeatControl(process: ProcessRecord): Promise<void> {
  let processes: ProcessRecord[];
  try {
    processes = await apiClient.listProcesses();
  } catch {
    // Already logged once by index.ts's own tick() for this same failure -
    // nothing further to do this tick.
    return;
  }

  const errorEntries: MessageInput[] = [];
  const warningEntries: MessageInput[] = [];

  for (const monitored of processes) {
    const { stoppable, warning, error } = monitored.heartbeat_control;
    if (stoppable && monitored.heartbeatStopped) continue;
    if (!warning && !error) continue;

    const ticks = skippedTicks(monitored.heartbeatLastSeenAt);
    if (ticks === null) continue;

    // Error takes precedence over warning, same mutual-exclusivity
    // convention as resourceMonitor.ts's own critical/warning split - a
    // process is never reported as both at once.
    if (error && ticks >= error.numberSkippedTicks) {
      errorEntries.push({
        code: `stale_process_${monitored.id}`,
        level: error.level,
        text: `Process '${monitored.name}' hasn't sent a heartbeat in ${ticks} ticks`,
      });
    } else if (warning && ticks >= warning.numberSkippedTicks) {
      warningEntries.push({
        code: `stale_process_${monitored.id}`,
        level: warning.level,
        text: `Process '${monitored.name}' hasn't sent a heartbeat in ${ticks} ticks`,
      });
    }
  }

  // Same row-highlight convention as resourceMonitor.ts - the boolean
  // flags drive the table row's red/yellow background, independent of
  // (but alongside) the WEM entries above which drive the notification
  // list/Dashboard.
  await apiClient.setCritical(process.id, errorEntries.length > 0);
  await apiClient.setWarning(process.id, errorEntries.length === 0 && warningEntries.length > 0);

  await apiClient.syncMessages(process.id, "error", errorEntries);
  await apiClient.syncMessages(process.id, "warning", warningEntries);
}
