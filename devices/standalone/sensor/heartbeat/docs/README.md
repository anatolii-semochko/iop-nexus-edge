# Heartbeat

Atomic sensor device - a free-running `Uint32` counter, incremented once
per second by the node's own firmware. Added 2026-08-09 for the "НОДА
КОНТРОЛЮ" watchdog board (AGENTS_TO_DO.md) as the mechanism that finally
lets the platform's Heartbeating Control (AGENTS.md section 28) actually
track node liveness - previously process-only (`heartbeatControl.ts`'s
own comment: "Devices/nodes are not evaluated here at all yet... no real
heartbeat producer for either kind today"). This device is that producer,
for nodes.

## Behavior

- Single value, `Uint32`, no units (a plain count).
- Pure sensor - **read-only** from the platform's perspective. The
  *value itself* carries no meaning - what matters to a reader is only
  whether it changed since the last read (see contract.schema.ts for why:
  the CAN transport caches "latest frame" with no expiry, so a value that
  never changes would misread as "still alive" forever).
- Read once per tick by the control-node's own permanent process
  (`apps/orchestrator/src/processes/controlNode.ts`), which compares the
  value against what it saw last tick and, on a change, calls
  `POST /nodes/heartbeat` - the node-side counterpart of
  `POST /processes/heartbeat`, added alongside this device (see
  `apps/api/src/heartbeatControl.ts`).

## Physical mapping (future firmware)

A plain incrementing counter in the node's main 1Hz loop, transmitted on
its own CAN arbitration ID (see `control-node`'s node docs for the full
frame layout). Independent of, and in the opposite direction from, this
same node's `../pulse` device - the two together give both sides of the
link their own, mutually-independent liveness check.

## Provisioning

Manually wired: a static EdgeX device-list entry (target-project
`extra-res/devices/`) plus a Postgres seed migration - see
`control-node`'s node docs. No automated provisioning flow exists yet (a
known, pre-existing gap, same as every other device type).
