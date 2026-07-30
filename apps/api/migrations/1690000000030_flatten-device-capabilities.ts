import type { MigrationBuilder } from "node-pg-migrate";

// devices.capabilities drops its "resources" array wrapper (AGENTS_TO_DO.md's
// 2026-07-27 Device/Node refactor, roadmap Phase 2.1) - a Device is atomic
// now (one value), so "0 or 1 resource" collapses to a flat object
// directly on the row instead of an array of length 0/1. `forbidden`
// (cross-resource rules) is dropped from here entirely - it moves to
// `nodes.forbidden` (migration ...028, Proposal A), and neither of these
// two devices ever had a `forbidden` entry to begin with.
//
// New field not in the roadmap's original flat shape as written
// ({readOnly?, min?, max?, step?}): `edgexResource`. Needed in practice -
// apps/api still has to know which EdgeX deviceResource/command name to
// call for this device's single value (Phase 1 gave each new EdgeX
// profile a domain-specific resource name - "Heater", "Level", etc, not a
// generic "Value" - to stay consistent with light-regulator/active-buzzer,
// which already use their own domain names and are NOT being renamed).
// This is an internal EdgeX-call detail, not a re-introduction of
// "resource" as an addressable/loggable dimension - there is no more
// .../resources/:name in the URL, no resource column in the logs, no
// per-resource Redis key; every Device still has exactly one value.
const LIGHT_REGULATOR_CAPABILITIES = {
  edgexResource: "Level",
  readOnly: true,
  min: 0,
  max: 100,
  step: 1,
};
const ACTIVE_BUZZER_CAPABILITIES = {
  edgexResource: "Buzzer",
};

const PREVIOUS_LIGHT_REGULATOR_CAPABILITIES = {
  resources: [{ name: "Level", readOnly: true, min: 0, max: 100, step: 1 }],
};
const PREVIOUS_ACTIVE_BUZZER_CAPABILITIES = {
  resources: [{ name: "Buzzer" }],
};

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(
    `UPDATE devices SET capabilities = '${JSON.stringify(LIGHT_REGULATOR_CAPABILITIES)}'::jsonb, updated_at = now() WHERE name = 'light-regulator-01'`,
  );
  pgm.sql(
    `UPDATE devices SET capabilities = '${JSON.stringify(ACTIVE_BUZZER_CAPABILITIES)}'::jsonb, updated_at = now() WHERE name = 'active-buzzer-01'`,
  );
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(
    `UPDATE devices SET capabilities = '${JSON.stringify(PREVIOUS_LIGHT_REGULATOR_CAPABILITIES)}'::jsonb, updated_at = now() WHERE name = 'light-regulator-01'`,
  );
  pgm.sql(
    `UPDATE devices SET capabilities = '${JSON.stringify(PREVIOUS_ACTIVE_BUZZER_CAPABILITIES)}'::jsonb, updated_at = now() WHERE name = 'active-buzzer-01'`,
  );
};
