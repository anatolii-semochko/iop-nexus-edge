// "heartbeat-control-test" process kind (AGENTS.md's Heartbeating
// Control section) - a dummy PERMANENT process (not controllable - an
// earlier draft wrongly reused the generic ON/OFF status mechanism here,
// which is a deliberately non-urgent, timer-only broadcast field and
// visibly lagged in the UI as a result, confirmed by the user) whose
// only purpose is letting "Heartbeating Control"'s escalation behavior be
// exercised on demand. Its own bespoke `heartbeatTestSimulateFailure`
// flag (Redis, toggled from a switch inside its own detail panel) is
// what this checks instead: while `false`, this simply succeeds (a
// normal, silent tick); while `true`, it deliberately throws -
// `index.ts`'s tick() already excludes a throwing process from this
// tick's heartbeat-touch batch, so this genuinely simulates a dead
// heartbeat, not merely a paused check. The process's own separate
// `stoppable`/`stopped` flag (set from the combined Heartbeating Control
// list, not from here) is an orthogonal, second test lever - it controls
// whether the watchdog bothers checking this process at all, independent
// of whether it's actually ticking.
import type { ProcessRecord } from "../apiClient.js";

export async function runHeartbeatControlTest(process: ProcessRecord): Promise<void> {
  if (process.heartbeatTestSimulateFailure) {
    throw new Error("heartbeat-control-test: simulated failure (test switch is on)");
  }
}
