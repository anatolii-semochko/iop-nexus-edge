import type { MigrationBuilder } from "node-pg-migrate";

// temperature-control/temperature-monitor process CODE moved out of this
// repo entirely (AGENTS_TO_DO.md 2026-07-29 "chistiy proekt" Фаза Б) - unlike
// light-regulator/active-buzzer/heartbeat-control-test (migration 034,
// gated behind SEED_DEMO_FIXTURES - still genuinely usable demo fixtures
// for this repo's own local dev, since their process/no-process code
// still lives here), there is no runner left in this repo's own
// apps/orchestrator for these two kinds at all any more. Seeding their
// rows even with SEED_DEMO_FIXTURES=true would leave dead, frozen
// process rows in nexus-edge's own local dev database (orchestrator
// silently skips a kind with no registered runner) - so this removal is
// unconditional, not flag-gated like migration 034's.
//
// A new migration rather than editing 007/031/033/034 in place - this
// session's established discipline (AGENTS_TO_DO.md) never edits an
// already-applied migration.
//
// EDITED same day after landing (exception to the rule above, not a
// second violation of it): the original `WHERE kind IN (...)` matched
// ANY process using these kind strings, not just nexus-edge's own -
// caught live deleting nexus-edge-smart-house's legitimate "Living Room
// Temperature Control"/"...Monitor" rows (same kind, different name/
// node - the kind string is a process-plugin dispatch key, shared by
// design, AGENTS.md section 31). Scoped to the specific node this
// repo's own migration 031 created instead - a target project's own
// same-kind processes on their own node are never touched. Restored
// nexus-edge-smart-house's deleted rows by re-running its own
// migrate-extra (idempotent WHERE NOT EXISTS guard, migrations/
// 002_seed_living_room_thermal.sql) after this fix landed.
export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    DELETE FROM processes
    WHERE kind IN ('temperature-control', 'temperature-monitor')
      AND node_id = (SELECT id FROM nodes WHERE name = 'example-thermal-node-01')
  `);
  pgm.sql(`
    DELETE FROM devices
    WHERE name IN ('example-temperature-01', 'example-heater-01', 'example-cooler-01', 'example-switch-01')
  `);
  pgm.sql(`DELETE FROM nodes WHERE name = 'example-thermal-node-01'`);
  pgm.sql(`
    DELETE FROM process_groups
    WHERE name = 'Temperature Control'
      AND NOT EXISTS (SELECT 1 FROM processes WHERE group_id = process_groups.id)
  `);
};

// Deliberately no-op, same reasoning as migration 034's down().
export const down = (): void => {};
