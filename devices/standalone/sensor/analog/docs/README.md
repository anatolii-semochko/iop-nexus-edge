# Analog

Generic analog input - a single scaled numeric reading from an ADC
channel, for sensor kinds that don't warrant their own dedicated
device type yet (a placeholder until e.g. a specific water-flow or
gas sensor gets its own contract).

## Status

Catalog-only entry (AGENTS_TO_DO.md, 2026-08-02 elementary-components
package) - `library.json` + this doc + `icon.svg` only, no
`contract.schema.ts`/`edgex-device-profile.yaml`/Postgres seed yet.
Graduates to the full device-kind file set (see `switch/` for the
shape) once it has a real node/process to attach to.

## Physical mapping (future firmware)

No hardware exists for this device type yet. Intended: an STM32 ADC
pin read, scaled to whatever range the specific sensor needs, pushed
over the node's bus on change (same intended shape as
`actuator/light-regulator`'s own note).
