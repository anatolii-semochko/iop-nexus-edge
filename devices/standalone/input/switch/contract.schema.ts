/**
 * Switch - atomic manual-input device, independent library Device type
 * (AGENTS.md section 7/30/32), typically paired with `temperature`/
 * `heater`/`cooler` under `devices/nodes/example-thermal-node/` (that
 * node type's own `supports:` list in node.yaml, not a physical folder
 * nesting). A single boolean input/output with no wiring to any process
 * (apps/orchestrator) - kept deliberately unused, per an explicit
 * instruction to preserve all four original devices rather than dropping
 * the one with no current consumer.
 *
 * A Device is atomic (AGENTS.md section 30) - exactly one value, so this
 * contract has no `resources` map the way an older, since-corrected
 * version of this device type did (it used to be bundled with
 * temperature/heater/cooler as three "resources" of one EdgeX device).
 *
 * This is the single source of truth this device type's EdgeX profile
 * (edgex-device-profile.yaml) and Postgres seed
 * (apps/api/migrations/..._seed-example-thermal-node.ts) are meant to
 * agree with. Nothing yet reads this file at runtime across process
 * boundaries (Go, SQL) - see the Implementation status note in AGENTS.md
 * section 7: kept in sync by hand today, same as every other device type.
 */
export const switchContract = {
  deviceType: 'switch',
  readOnly: false,
  valueType: 'Bool',
  description: 'Example manual switch - not read by any process, kept for future use',
}
