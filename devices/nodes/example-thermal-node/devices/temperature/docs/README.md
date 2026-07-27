# Temperature

Atomic sensor device on `example-thermal-node` - a smoke-test/demo device
type, not built for any real target project. Read via `GET /devices/:id`
and driven by the "temperature-control"/"temperature-monitor" process kinds
(AGENTS.md section 10) as their `sensorDeviceId`.

## Behavior

- Single value, `Float32`, no fixed range (a simulated ambient reading).
- Pure sensor - **read-only** from the platform's perspective
  (`capabilities.readOnly: true`, see `apps/api/src/routes/devices.ts`). It
  has no `AUTO`/`MANUAL` mode: nothing ever commands it, it only reports
  its current reading.
- Its value can only be set via `PUT /devices/:id/simulate` (the Dev
  Simulator page) - simulating a person adjusting the ambient temperature.
  Even in dev mode it never goes through the normal MANUAL-override path
  (`PUT /devices/:id`), which is reserved for controllable (non-readOnly)
  devices.

## History

Before the 2026-07-28 Device/Node correction (AGENTS.md section 30), this
value was one of four "resources" (`Switch`/`Temperature`/`Heater`/
`Cooler`) bundled into a single EdgeX device, `example-virtual-sensor-01` -
a smoke-test fixture that had grown well beyond its original purpose (real
Temperature Control/Safety Monitor processes, WEM examples, Heartbeating
Control tests, Logs page test data all depended on it) while still
modeling three physically separate devices (a sensor and two relays) as if
they were one. Split into this device plus `../heater`, `../cooler`,
`../switch` on one shared Node (`example-thermal-node-01`) instead.

## Physical mapping (future firmware)

Not built yet - no hardware exists for this device type. `runtime/` and
`firmware/` (part of AGENTS.md section 7's full device-type layout) are
deliberately not created yet: the generic Virtual Node Runtime get/set
store (`apps/device-service/internal/virtual`) already behaves correctly
for a value with no internal dynamics of its own.

## Provisioning

Manually wired: a static EdgeX device-list entry
(`apps/device-service/res/devices/example-devices.yaml`) plus a Postgres
seed migration
(`apps/api/migrations/..._seed-example-thermal-node.ts`). There is still
no automated provisioning flow (a Devices API endpoint to create a device
in both Postgres and EdgeX at once, and register it against a Node) - a
known, pre-existing gap this device type does not resolve.
