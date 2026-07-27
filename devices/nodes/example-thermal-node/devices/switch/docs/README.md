# Switch

Atomic manual-input device on `example-thermal-node` - a smoke-test/demo
device type, not built for any real target project.

## Behavior

- Single value, `Bool`.
- Ordinary actuator - has a normal `AUTO`/`MANUAL` mode via the Dual
  Devices Model (AGENTS.md section 6).
- Not read by any process kind (neither "temperature-control" nor
  "temperature-monitor") - kept on the Node deliberately unused, as an
  example of a device that exists without process wiring, rather than
  dropped for being idle.
- No forbidden-state relationship with any other device on this Node.

## History

Before the 2026-07-28 Device/Node correction (AGENTS.md section 30), this
was one of four "resources" bundled into a single EdgeX device,
`example-virtual-sensor-01` - see `../temperature/docs/README.md` for the
full story. It was already unused by any process before the split, and
remains so as its own atomic device now.

## Physical mapping (future firmware)

Not built yet - no hardware exists for this device type. `runtime/` and
`firmware/` are deliberately not created yet - the generic Virtual Node
Runtime already behaves correctly for a plain boolean with no internal
dynamics of its own.

## Provisioning

Manually wired: a static EdgeX device-list entry
(`apps/device-service/res/devices/example-devices.yaml`) plus a Postgres
seed migration (`apps/api/migrations/..._seed-example-thermal-node.ts`).
No automated provisioning flow exists yet (a known, pre-existing gap).
