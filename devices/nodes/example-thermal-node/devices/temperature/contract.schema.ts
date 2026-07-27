/**
 * Temperature - atomic sensor on the example-thermal-node (AGENTS.md
 * section 7/30). A single simulated temperature reading: reports its
 * current value, never accepts commands (see safety.yaml - there is
 * nothing to forbid on this device alone; the real interlock this node
 * cares about is between its sibling heater/cooler devices - see the
 * node's own safety.yaml).
 *
 * A Device is atomic (AGENTS.md section 30) - exactly one value, so this
 * contract has no `resources` map the way an older, since-corrected
 * version of this device type did (it used to be bundled with heater/
 * cooler/switch as three "resources" of one EdgeX device).
 *
 * This is the single source of truth this device type's EdgeX profile
 * (edgex-device-profile.yaml) and Postgres seed
 * (apps/api/migrations/..._seed-example-thermal-node.ts) are meant to
 * agree with. Nothing yet reads this file at runtime across process
 * boundaries (Go, SQL) - see the Implementation status note in AGENTS.md
 * section 7: kept in sync by hand today, same as every other device type.
 */
export const temperatureContract = {
  deviceType: 'temperature',
  // No AUTO/MANUAL concept at all - a pure sensor, never commanded
  // (apps/api's devices.capabilities.readOnly).
  readOnly: true,
  valueType: 'Float32',
  units: 'C',
  description: 'Example simulated temperature sensor',
}
