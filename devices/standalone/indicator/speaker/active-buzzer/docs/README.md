# Active Zummer (active buzzer)

Standalone virtual actuator - a single active buzzer with a built-in tone
generator, modeled on the platform's "first real device type" precedent
(`devices/standalone/actuator/light-regulator/`, AGENTS.md section 7).

## Behavior

- Single value, `Buzzer`: `Bool`. `true` sounds the buzzer, `false` is
  silent - no tone/frequency control, an active buzzer generates its own
  fixed tone internally.
- Ordinary actuator (**not** read-only) - has a normal AUTO/MANUAL Dual
  Devices Model concept, same as Cooler/Heater on the example device.
- Driven AUTO, every tick, by the `active-buzzer` process kind
  (`apps/orchestrator/src/processes/activeBuzzer.ts`) - see AGENTS.md's
  Active Zummer section for the full alarm-priority policy (which WEM
  severity wins, `constant`/`shortBeep`/`longBeep` timing). This device
  type itself has no policy logic - it is a dumb binary output, exactly
  like the real hardware will be.
- In production (`ui/control`) it renders as the shared `BuzzerIndicator`
  atom (`apps/ui/src/components/indicators/BuzzerIndicator.jsx`) - a
  read-only visualization of the currently commanded state, not an
  interactive control (nothing about *how* it sounds is set here - that's
  the Message Levels settings, Processes -> Settings tab).
- No custom `ui/simulator` - a plain `Bool` actuator is already well
  served by the Dev Simulator's generic instant checkbox, unlike
  light-regulator's ranged `Level`, which needed a dedicated slider.

## Physical mapping (future firmware)

Not built yet - no hardware exists for this device type. The intended
mapping, per the user's own plan: CAN -> STM32 -> a single digital output
port (Port0/1). `runtime/` and `firmware/` are deliberately not created
yet, same reasoning as light-regulator - the generic Virtual Node Runtime
already behaves correctly for a plain boolean with no internal dynamics of
its own.

## Provisioning

Manually wired, the same way as light-regulator: a static EdgeX
device-list entry
(`apps/device-service/res/devices/active-buzzer-devices.yaml`) plus a
Postgres seed migration
(`apps/api/migrations/..._seed-active-buzzer-device.ts`). No automated
provisioning flow yet - same known, pre-existing gap every device type
here shares.
