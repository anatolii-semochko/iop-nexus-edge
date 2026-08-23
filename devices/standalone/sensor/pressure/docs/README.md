# Pressure

Atomic sensor device - single `Float32` atmospheric pressure reading.
Added 2026-08-23 for the "weather-node" outdoor station
(`Node Weather Control.txt`, AGENTS_TO_DO.md).

## Behavior

- Single value, `Float32`, `hPa`.
- Pure sensor - **read-only** from the platform's perspective
  (`capabilities.readOnly: true`). No `AUTO`/`MANUAL` mode - nothing ever
  commands it, it only reports its current reading.
- Its value can be set via `PUT /devices/:id/simulate` (the Dev Simulator
  page) for a `backend: virtual` instance - same convention as
  `../temperature`/`../humidity`.

## Physical mapping (future firmware)

Target hardware: BMP280 (I2C). BMP280 also reports its own temperature,
which weather-node's firmware reads and discards - weather-node's AHT20
(`../temperature`) is the node's one temperature Device, so BMP280's
temperature output never becomes a Device of its own (would be a
redundant second reading of the same physical quantity). See
`weather-node`'s own docs for the full sensor rationale and CAN frame
layout.

## Provisioning

Manually wired: a static EdgeX device-list entry (target-project
`extra-res/devices/`) plus a Postgres seed migration, same pattern as
every other device type. No automated provisioning flow exists yet (a
known, pre-existing gap, same as every other device type).
