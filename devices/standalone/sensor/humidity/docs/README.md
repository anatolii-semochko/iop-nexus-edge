# Humidity

Atomic sensor device - single `Float32` relative-humidity reading. Added
2026-08-09 as the humidity half of the "НОДА КОНТРОЛЮ" watchdog board's
environment sensor (AGENTS_TO_DO.md) - the target hardware (AHT10/AHT20)
is one physical I2C chip reporting both temperature and humidity, but per
this library's atomic-device convention (see `../temperature`'s own docs)
that is two separate Device rows, not one compound device. Both typically
sit on the same physical Node, sharing one CAN arbitration ID at
different byte offsets in firmware (see `control-node`'s node docs for
the CAN frame layout) - that pairing is firmware/wiring detail, not
anything this device type's contract needs to know about.

## Behavior

- Single value, `Float32`, `%RH`.
- Pure sensor - **read-only** from the platform's perspective
  (`capabilities.readOnly: true`). No `AUTO`/`MANUAL` mode - nothing ever
  commands it, it only reports its current reading.
- Its value can be set via `PUT /devices/:id/simulate` (the Dev Simulator
  page) for a `backend: virtual` instance - same convention as
  `../temperature`.

## Physical mapping (future firmware)

Target hardware: AHT10/AHT20 (I2C) - see `control-node`'s own docs for
the full sensor rationale (chosen over DHT11 for the hardware I2C
peripheral vs. DHT's software bit-bang timing). A DS18B20-only stand-in
(temperature, no humidity - used for early bring-up before AHT10/AHT20
arrives) simply never provisions this device; the permanent process
reading it tolerates a missing humidity reading.

## Provisioning

Manually wired: a static EdgeX device-list entry (target-project
`extra-res/devices/`) plus a Postgres seed migration, same pattern as
every other device type - see `control-node`'s node docs for this
specific pairing. No automated provisioning flow exists yet (a known,
pre-existing gap, same as every other device type).
