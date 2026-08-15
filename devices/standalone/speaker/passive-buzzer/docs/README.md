# Passive Buzzer

Standalone virtual actuator - same single-Bool "is it sounding" shape as
`../active-buzzer`, split into its own device type purely for the
physical/firmware distinction (AGENTS.md section 7, section 51's own
correction).

## Behavior

- Single value, `Buzzer`: `Bool`. `true` sounds the buzzer, `false` is
  silent - identical contract to Active Buzzer from NexusEdge's own
  point of view.
- The real difference is on the firmware/hardware side: a passive
  buzzer has no built-in tone generator - producing any sound at all
  requires the driving MCU to generate the waveform itself (PWM/
  `tone()`). An active buzzer just needs power applied. Modeled as its
  own type so the Library/Devices UI can show a distinct icon and so a
  future firmware author reaching for this type knows they need to
  drive it, not just switch it.
- Renders with the same shared `BuzzerIndicator`/control-style lamp as
  Active Buzzer (`ui/control/PassiveBuzzerControl.jsx`) - visually
  identical, since NexusEdge only ever sees the commanded/mirrored
  boolean state either way.

## Real instance: control-node

control-node's own buzzer (`control-node-buzzer`,
nexus-edge-aquarium's `migrations/001_seed_control_node.sql`) is this
type's first real usage - reassigned 2026-08-14 from `active-buzzer`
after the crackle-bug fix (AGENTS.md section 51) made it obvious the
firmware genuinely drives it via `tone()`/`noTone()`, not a built-in
oscillator. The underlying EdgeX profile (`NexusEdge-ActiveBuzzer`,
canId `0x304`) was deliberately left unchanged - this is a NexusEdge-
side taxonomy correction, not a CAN/EdgeX contract change.

## Provisioning

Same as active-buzzer - no automated provisioning flow, a target
project wires a real instance via its own `extra-res/devices/*.yaml` +
Postgres seed migration.
