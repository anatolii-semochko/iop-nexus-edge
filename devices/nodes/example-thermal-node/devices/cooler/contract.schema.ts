/**
 * Cooler - atomic relay actuator on the example-thermal-node (AGENTS.md
 * section 7/30). A single boolean output driving a physical cooling
 * relay: `true` cools, `false` is idle. Paired with `../heater` on the
 * same Node - the two must never both be active at once, a rule declared
 * on the NODE's own safety.yaml (../../safety.yaml), not this device's
 * (which is always empty - a cross-device rule can't live on one device
 * alone anymore, AGENTS.md section 30).
 *
 * A Device is atomic (AGENTS.md section 30) - exactly one value, so this
 * contract has no `resources` map the way an older, since-corrected
 * version of this device type did (it used to be bundled with
 * temperature/heater/switch as three "resources" of one EdgeX device).
 *
 * This is the single source of truth this device type's EdgeX profile
 * (edgex-device-profile.yaml) and Postgres seed
 * (apps/api/migrations/..._seed-example-thermal-node.ts) are meant to
 * agree with. Nothing yet reads this file at runtime across process
 * boundaries (Go, SQL) - see the Implementation status note in AGENTS.md
 * section 7: kept in sync by hand today, same as every other device type.
 */
export const coolerContract = {
  deviceType: 'cooler',
  // Ordinary actuator - has an AUTO/MANUAL concept (Dual Devices Model),
  // unlike temperature's read-only sensor. Driven AUTO by the
  // "temperature-control" process kind (apps/orchestrator/src/processes/
  // temperatureControl.ts) via PUT /devices/:id/auto.
  readOnly: false,
  valueType: 'Bool',
  description: 'Example cooler relay - must never be on at the same time as ../heater',
}
