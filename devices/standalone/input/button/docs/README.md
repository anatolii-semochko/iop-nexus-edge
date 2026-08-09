# Button

Momentary pushbutton, normally-open contact - reads `true` only while
physically held, `false` otherwise (distinct from `../switch`, which
latches).

## Behavior

- Single value, `Bool`.
- `readOnly: false`, same convention as `../switch` - see this device
  type's own contract.schema.ts comment for why.
- First real consumer: the "control-node" node type's own "Mute Beeper"
  button (AGENTS_TO_DO.md, 2026-08-09 "НОДА КОНТРОЛЮ") - a physical
  momentary press that silences that board's buzzer for the current
  incident. NexusEdge only mirrors this device's state for UI
  visibility; the actual mute behavior is 100% autonomous firmware, not
  driven by anything read here.

## Physical mapping (future firmware)

A digital input pin, debounced in firmware - see `control-node`'s own
node docs for the specific pin/CAN mapping.

## Provisioning

Manually wired: a static EdgeX device-list entry (target-project
`extra-res/devices/`) plus a Postgres seed migration - see
`control-node`'s node docs. No automated provisioning flow exists yet (a
known, pre-existing gap, same as every other device type).

## History

Started as a catalog-only entry (`library.json` + `icon.svg` + a short
status stub, AGENTS_TO_DO.md 2026-08-02 elementary-components package) -
graduated to this full file set once it got a real node/process to
attach to.
