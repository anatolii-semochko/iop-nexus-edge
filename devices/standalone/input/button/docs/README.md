# Button

Momentary pushbutton, normally-open contact - reads `true` only while
physically held, `false` otherwise (distinct from `switch`, which
latches).

## Status

Catalog-only entry (AGENTS_TO_DO.md, 2026-08-02 elementary-components
package) - `library.json` + this doc + `icon.svg` only, no
`contract.schema.ts`/`edgex-device-profile.yaml`/Postgres seed yet.
Graduates to the full device-kind file set (see `switch/` for the
shape) once it has a real node/process to attach to.

## Physical mapping (future firmware)

No hardware exists for this device type yet. Intended: a digital
input pin, active-low or active-high depending on pull resistor
choice, debounced in firmware.
