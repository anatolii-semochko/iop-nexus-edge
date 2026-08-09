# Pulse

Atomic actuator device - a single `Bool`, written `true` once per second,
every orchestrator tick. Added 2026-08-09 for the "НОДА КОНТРОЛЮ"
watchdog board (AGENTS_TO_DO.md).

## Behavior

- Single value, `Bool`. Written via the normal AUTO write path
  (`setDeviceAuto`), same as any other actuator - not a bespoke command.
- The *value itself* is meaningless - the node's own firmware only cares
  that a fresh CAN frame arrived recently on this resource's arbitration
  ID, not what it contains. Nothing ever reads this device back for its
  value.
- Written every tick by the control-node's own permanent process
  (`apps/orchestrator/src/processes/controlNode.ts`) - the *other*
  heartbeat direction from `../sensor/heartbeat` (that one: node -> is
  NexusEdge watching; this one: NexusEdge -> is the node watching). The
  two are entirely independent - confirmed with the user, AGENTS_TO_DO.md
  2026-08-09.

## Physical mapping (future firmware)

The node's firmware watches this resource's CAN arbitration ID; losing
it for >2s (3 missed 1Hz writes, counted from the first missed one) is
what drives the node's own autonomous yellow/red LED and buzzer
escalation, and eventually its reset-attempt schedule - all of that logic
lives entirely in firmware, independent of NexusEdge, since the point of
a watchdog is to keep signaling even after NexusEdge itself has crashed.
See `control-node`'s node docs for the full escalation timeline and the
CAN frame layout.

## Provisioning

Manually wired: a static EdgeX device-list entry (target-project
`extra-res/devices/`) plus a Postgres seed migration - see
`control-node`'s node docs. No automated provisioning flow exists yet (a
known, pre-existing gap, same as every other device type).
