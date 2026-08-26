# Relay

Generic controllable relay - single Bool actuator, on/off. The
elementary building block `heater`/`cooler` are already semantic
wrappers around (both are literally "single Bool actuator" today);
this entry exists for relay outputs that don't have a more specific
name yet.

## Status

Catalog-only entry (AGENTS_TO_DO.md, 2026-08-02 elementary-components
package) - `library.json` + this doc + `icon.svg` only, no
`contract.schema.ts`/`edgex-device-profile.yaml`/Postgres seed yet.
Graduates to the full device-kind file set (see `switch/` for the
shape) once it has a real node/process to attach to.

## Physical mapping (future firmware)

No hardware exists for this device type yet. I2C relay boards are the
priority target (per the user's own request) over a bare GPIO-driven
relay - lets one node drive many relays off a couple of pins.
