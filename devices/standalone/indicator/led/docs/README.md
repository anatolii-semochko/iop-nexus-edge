# LED

Single-color status LED, on/off - a PWM-dimmable variant would be a
distinct device type, not a mode of this one (same split
`actuator/light-regulator` already draws for its own dimming
behavior). `led R`/`led G`/`led B`/`led RGB` from the original
elementary-components request are deliberately not built as separate
entries - would need a real multi-channel contract, not just copies
of this one.

## Behavior

- Single value, `Bool`.
- Ordinary actuator - has a normal `AUTO`/`MANUAL` mode via the Dual
  Devices Model (AGENTS.md section 6).
- First real consumer: the Alarm Annunciator node/process
  (AGENTS_TO_DO.md, 2026-08-02) - 16 instances (8 red/error, 8 yellow/
  warning), driven by that process every tick.

## Physical mapping (future firmware)

No hardware exists for this device type yet. Intended: a digital or
PWM output pin, same shape as `actuator/relay`.

## Provisioning

Manually wired: a static EdgeX device-list entry
(`apps/device-service/res/devices/annunciator-devices.yaml`) plus a
Postgres seed migration. No automated provisioning flow exists yet (a
known, pre-existing gap, same as every other device type).

## History

Started as a catalog-only entry (`library.json` + `icon.svg` + a short
status stub, AGENTS_TO_DO.md 2026-08-02 elementary-components
package) - graduated to this full file set once it got a real
node/process to attach to.
