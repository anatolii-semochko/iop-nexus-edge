# Cooler

Atomic relay actuator on `example-thermal-node` - a smoke-test/demo device
type, not built for any real target project. Driven by the
"temperature-control" process kind (AGENTS.md section 10) as its
`coolerDeviceId`, and read directly by "temperature-monitor" as a
defense-in-depth safety check.

## Behavior

- Single value, `Bool`. `true` cools, `false` is idle.
- Ordinary actuator - has a normal `AUTO`/`MANUAL` mode via the Dual
  Devices Model (AGENTS.md section 6), unlike `../temperature`'s read-only
  sensor.
- Must never be active at the same time as `../heater` - enforced by the
  Model State Validator against the Node's own `safety.yaml`/
  `nodes.forbidden` (AGENTS.md section 7/30), not this device's own
  `safety.yaml` (always empty).

## History

Before the 2026-07-28 Device/Node correction (AGENTS.md section 30), this
was one of four "resources" bundled into a single EdgeX device,
`example-virtual-sensor-01` - see `../temperature/docs/README.md` for the
full story. Its own forbidden-state rule against Heater used to live on
that single device's `capabilities.forbidden` (a cross-*resource* rule);
it now lives on the Node's `safety.yaml`/`nodes.forbidden` (a
cross-*device* rule), since Cooler and Heater are two separate devices now.

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
