# LED

Single-color status LED - on/off by default; a PWM-capable driver can
dim it instead of just switching it, same distinction as
`actuator/light-regulator`. Single-color only - `led R`/`led G`/
`led B`/`led RGB` from the original component list are deliberately
not built as separate entries yet (would need a real multi-channel
contract, not just three copies of this one).

## Status

Catalog-only entry (AGENTS_TO_DO.md, 2026-08-02 elementary-components
package) - `library.json` + this doc + `icon.svg` only, no
`contract.schema.ts`/`edgex-device-profile.yaml`/Postgres seed yet.
Graduates to the full device-kind file set (see `switch/` for the
shape) once it has a real node/process to attach to.

## Physical mapping (future firmware)

No hardware exists for this device type yet. Intended: a digital or
PWM output pin, same shape as `actuator/relay`/`actuator/light-
regulator`.
