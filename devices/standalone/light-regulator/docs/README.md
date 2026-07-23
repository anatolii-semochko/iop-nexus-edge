# Light Regulator

Standalone virtual sensor - a universal 0-100 linear regulator, modeled on
a physical rotary/linear dial (e.g. a potentiometer feeding an ADC). It is
the platform's first real device type provisioned under `devices/`
(AGENTS.md section 7), alongside `apps/device-service`'s
`NexusEdge-Example-Virtual` smoke-test fixture (still present, not
replaced by this).

## Behavior

- Single resource, `Level`: `Int32`, range `0-100`, step `1`.
- Pure sensor - **read-only** from the platform's perspective
  (`capabilities.resources[].readOnly: true`, see
  `apps/api/src/routes/devices.ts`). It has no `AUTO`/`MANUAL` mode:
  nothing ever commands it, it only reports its current position.
- In production (`ui/control`) it renders as a disabled slider - a visual
  gauge of the dial's current position, not an interactive control.
- In the Dev Simulator (`ui/simulator`) it renders as an interactive
  slider: dragging it calls `PUT
  /devices/:id/resources/Level/simulate`, simulating a person physically
  turning the dial. This is the only place its value can be set at all -
  even in dev mode it never goes through the normal MANUAL-override path
  (`PUT /devices/:id/resources/Level`), which is reserved for
  controllable (non-`readOnly`) resources.

## Physical mapping (future firmware)

Not built yet - no hardware exists for this device type. The intended
mapping: an STM32 ADC pin read, scaled to `0-100`, pushed over the node's
bus on change. `runtime/` and `firmware/` (part of AGENTS.md section 7's
full device-type layout) are deliberately not created yet: the generic
Virtual Node Runtime get/set store (`apps/device-service/internal/virtual`)
already behaves correctly for a value with no internal dynamics of its
own, so there is nothing for a custom `runtime/` module to add today.

## Provisioning

Manually wired, the same way as the existing smoke-test fixture: a static
EdgeX device-list entry
(`apps/device-service/res/devices/light-regulator-devices.yaml`) plus a
Postgres seed migration
(`apps/api/migrations/..._seed-light-regulator-device.ts`). There is still
no automated provisioning flow (a Devices API endpoint to create a device
in both Postgres and EdgeX at once) - a known, pre-existing gap this
device type does not resolve.
