/**
 * Active Zummer (active buzzer) - standalone virtual actuator (AGENTS.md
 * section 7). A single binary output driving a physical active buzzer's
 * built-in generator: `true` sounds, `false` is silent - no PWM/tone
 * control here, the buzzer itself generates its own tone.
 *
 * Real hardware mapping (not built yet): CAN -> STM32 -> a single digital
 * output port. `runtime/`/`firmware/` are deliberately absent for the same
 * reason as light-regulator's - the generic Virtual Node Runtime already
 * behaves correctly for a plain boolean with no internal dynamics, and
 * there is no hardware yet to target.
 *
 * This is the single source of truth this device type's EdgeX profile
 * (edgex-device-profile.yaml) and Postgres seed
 * (apps/api/migrations/..._seed-active-buzzer-device.ts) are meant to
 * agree with. Nothing yet reads this file at runtime across process
 * boundaries (Go, SQL) - see the Implementation status note in AGENTS.md
 * section 7: kept in sync by hand today, same as every other device type.
 *
 * A Device is atomic (AGENTS.md section 30) - exactly one value, so this
 * contract has no `resources` map the way it did before the 2026-07-28
 * Device/Node correction.
 */
export const activeBuzzerContract = {
  deviceType: 'active-buzzer',
  valueType: 'Bool',
  // Ordinary actuator - has an AUTO/MANUAL concept (Dual Devices Model),
  // unlike light-regulator's read-only Level. Driven AUTO by the
  // "active-buzzer" process kind (apps/orchestrator/src/processes/
  // activeBuzzer.ts) via PUT /devices/:id/auto, same as Cooler/Heater are
  // driven by temperature-control.
  readOnly: false,
  description: "Active buzzer's built-in generator - true sounds, false is silent",
}
