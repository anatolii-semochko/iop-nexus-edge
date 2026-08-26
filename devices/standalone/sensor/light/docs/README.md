# Light

Atomic sensor device - single `Uint16` raw photoresistor (LDR) reading.
Added 2026-08-23 for the "weather-node" outdoor station
(`Node Weather Control.txt`, AGENTS_TO_DO.md).

## Behavior

- Single value, `Uint16`, uncalibrated ADC count (not lux - the sensor
  isn't characterized for a photometric conversion).
- Pure sensor - **read-only** from the platform's perspective
  (`capabilities.readOnly: true`). No `AUTO`/`MANUAL` mode - nothing ever
  commands it, it only reports its current reading.
- Its value can be set via `PUT /devices/:id/simulate` (the Dev Simulator
  page) for a `backend: virtual` instance - same convention as
  `../temperature`/`../humidity`/`../pressure`.
- Consumed by the `weather-control` process kind, which derives a
  6-level category (`../light-level`) from this raw value on every tick -
  see that device type's own docs and `weather-control`'s process docs.

## Physical mapping (future firmware)

Target hardware: a simple photoresistor voltage divider into one of the
STM32's ADC pins - see `weather-node`'s own docs for the full sensor
rationale and CAN frame layout.

## Provisioning

Manually wired: a static EdgeX device-list entry (target-project
`extra-res/devices/`) plus a Postgres seed migration, same pattern as
every other device type. No automated provisioning flow exists yet (a
known, pre-existing gap, same as every other device type).
