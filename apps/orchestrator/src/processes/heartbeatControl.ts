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
// Nodes are now evaluated here too (added 2026-08-09, AGENTS_TO_DO.md
// "НОДА КОНТРОЛЮ") - the control-node's own `Heartbeat` device resource
// is the first real heartbeat producer for a node, touched via
// controlNode.ts's own runner calling POST /nodes/heartbeat. Devices
// still aren't evaluated - still no real heartbeat producer for that
// kind (confirmed scope with the user: processes first since they
// already had a natural 1s tick driver, nodes next once a real producer
// existed, devices whenever one shows up for them too).
//
// A `simulated` node (partial physical network, AGENTS_TO_DO.md,
// 2026-08-09/10) is skipped entirely, not just quietly stale - there is
// no real hardware link for it to be stale *from* while deliberately in
// bench-test/service mode (the user's own framing), so raising "hasn't
// sent a heartbeat" for one would be a permanent, un-actionable false
// alarm rather than a real fault signal. Found live: turning simulated
// on for a node whose Heartbeat device has no producer of its own kept
// tripping this exact alarm every few minutes.
//
// Deliberately not skipping this process's own id in the loop below - if
// its own runner only sometimes throws (rather than every tick), letting
// it evaluate itself like any other entry gives it a narrow chance of
// noticing its own accumulated staleness on a tick it does succeed. If it
// stops running entirely, nothing (including this) can catch that from
// inside the orchestrator - a true external watchdog would be needed for
// that case, out of scope here.

import { apiClient, type MessageInput, type NodeRecord, type ProcessRecord } from "../apiClient.js";
import { TICK_INTERVAL_MS } from "../tickInterval.js";

// `null` - never seen a heartbeat yet (a fresh deploy, or a process kind
// with no runner) - deliberately not treated as "infinitely stale", same
// defensive stance as resourceMonitor.ts's own "no CPU sample yet" skip.
function skippedTicks(lastSeenAt: string | null): number | null {
  if (!lastSeenAt) return null;
  const elapsedMs = Date.now() - new Date(lastSeenAt).getTime();
  return Math.floor(elapsedMs / TICK_INTERVAL_MS);
}

// Shared by both the process and node loops below - same entity shape as
// far as staleness evaluation cares (heartbeat_control config + live
// heartbeatStopped/heartbeatLastSeenAt), just sourced from two different
// list endpoints. `kind` only affects the WEM message code/text prefix,
// so a process and a node with the same numeric id never collide on one
// `stale_*` code.
interface HeartbeatEntity {
  id: number;
  name: string;
  heartbeat_control: ProcessRecord["heartbeat_control"];
  heartbeatStopped: boolean;
  heartbeatLastSeenAt: string | null;
  // Only ever set on a NodeRecord - undefined for a process, which has
  // no such concept. See this file's own header comment.
  simulated?: boolean;
}

function evaluate(
  kind: "process" | "node",
  entities: HeartbeatEntity[],
  errorEntries: MessageInput[],
  warningEntries: MessageInput[],
): void {
  const label = kind === "process" ? "Process" : "Node";
  for (const monitored of entities) {
    if (monitored.simulated) continue;
    const { stoppable, warning, error } = monitored.heartbeat_control;
    if (stoppable && monitored.heartbeatStopped) continue;
    if (!warning && !error) continue;

    const ticks = skippedTicks(monitored.heartbeatLastSeenAt);
    if (ticks === null) continue;

    // Error takes precedence over warning, same mutual-exclusivity
    // convention as resourceMonitor.ts's own critical/warning split - an
    // entity is never reported as both at once.
    if (error && ticks >= error.numberSkippedTicks) {
      errorEntries.push({
        code: `stale_${kind}_${monitored.id}`,
        level: error.level,
        text: `${label} '${monitored.name}' hasn't sent a heartbeat in ${ticks} ticks`,
      });
    } else if (warning && ticks >= warning.numberSkippedTicks) {
      warningEntries.push({
        code: `stale_${kind}_${monitored.id}`,
        level: warning.level,
        text: `${label} '${monitored.name}' hasn't sent a heartbeat in ${ticks} ticks`,
      });
    }
  }
}

export async function runHeartbeatControl(process: ProcessRecord): Promise<void> {
  let processes: ProcessRecord[];
  let nodes: NodeRecord[];
  try {
    [processes, nodes] = await Promise.all([apiClient.listProcesses(), apiClient.listNodes()]);
  } catch {
    // Already logged once by index.ts's own tick() for this same failure -
    // nothing further to do this tick.
    return;
  }

  const errorEntries: MessageInput[] = [];
  const warningEntries: MessageInput[] = [];

  evaluate("process", processes, errorEntries, warningEntries);
  evaluate("node", nodes, errorEntries, warningEntries);

  // Same row-highlight convention as resourceMonitor.ts - the boolean
  // flags drive the table row's red/yellow background, independent of
  // (but alongside) the WEM entries above which drive the notification
  // list/Dashboard.
  await apiClient.setCritical(process.id, errorEntries.length > 0);
  await apiClient.setWarning(process.id, errorEntries.length === 0 && warningEntries.length > 0);

  await apiClient.syncMessages(process.id, "error", errorEntries);
  await apiClient.syncMessages(process.id, "warning", warningEntries);
}
