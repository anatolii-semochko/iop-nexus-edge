/**
 * Light Regulator - standalone virtual sensor (AGENTS.md section 7).
 *
 * A single physical dial/potentiometer read as 0-100: turning it pushes a
 * new value into the system, it never accepts commands (see safety.yaml -
 * there is nothing to forbid, since it can't be actuated at all).
 *
 * This is the single source of truth this device type's EdgeX profile
 * (edgex-device-profile.yaml), Postgres seed
 * (apps/api/migrations/..._seed-light-regulator-device.ts), and both UI
 * components (ui/control, ui/simulator) are meant to agree with. Nothing
 * yet reads this file at runtime across process boundaries (Go, SQL) - see
 * the Implementation status note in AGENTS.md section 7: no device type
 * has cross-layer enforcement wired up yet, this is kept in sync by hand
 * today, same as every other device type would be.
 *
 * A Device is atomic (AGENTS.md section 30) - exactly one value, so this
 * contract has no `resources` map the way it did before the 2026-07-28
 * Device/Node correction.
 */
export const lightRegulatorContract = {
  deviceType: 'light-regulator',
  valueType: 'Int32',
  // No AUTO/MANUAL concept at all - a pure sensor, never commanded
  // (apps/api/src/routes/devices.ts DeviceCapabilities.readOnly).
  readOnly: true,
  min: 0,
  max: 100,
  step: 1,
  description: 'Current position of the physical linear regulator (0-100)',
}
