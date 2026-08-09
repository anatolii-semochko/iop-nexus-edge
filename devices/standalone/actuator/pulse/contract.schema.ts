/**
 * Pulse - atomic actuator, independent library Device type (AGENTS.md
 * section 7/30/32), added 2026-08-09 for the "НОДА КОНТРОЛЮ" watchdog
 * board (AGENTS_TO_DO.md). Written once per second, every orchestrator
 * tick, by that node's own permanent process
 * (`apps/orchestrator/src/processes/controlNode.ts`) - the node's
 * firmware watches for this write arriving (as a fresh CAN frame) to
 * know NexusEdge itself is alive; losing it for >2s (3 missed writes)
 * drives the node's own autonomous LED/buzzer/reset escalation, entirely
 * independent of NexusEdge (that escalation logic lives in firmware, not
 * here - the whole point is that it must keep working even if NexusEdge
 * has crashed).
 *
 * `Bool`, always written `true` - the *value* itself is meaningless (the
 * node's firmware only cares that a frame arrived recently, not what it
 * contains); a `Bool` was chosen over e.g. a toggling/incrementing value
 * only because it's the simplest type this library's CAN codec supports
 * for a value nobody actually reads. This is the software-side control
 * device for the opposite heartbeat direction from `../heartbeat` -
 * confirmed with the user (AGENTS_TO_DO.md 2026-08-09): NexusEdge and the
 * node each independently watch the other's own heartbeat, unrelated
 * mechanisms.
 *
 * `readOnly: false` (an actuator, not a sensor) even though nothing ever
 * reads it back meaningfully - it still goes through the normal
 * AUTO/MANUAL write path (`setDeviceAuto`) like any other actuator, not
 * a bespoke command.
 */
export const pulseContract = {
  deviceType: 'pulse',
  readOnly: false,
  valueType: 'Bool',
  description: "Written once/sec by the orchestrator - proves NexusEdge is alive to the node's firmware",
}
