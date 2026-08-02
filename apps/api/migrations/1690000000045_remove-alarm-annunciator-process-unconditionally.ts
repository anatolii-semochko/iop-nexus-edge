import type { MigrationBuilder } from "node-pg-migrate";

// "alarm-annunciator" process CODE moved out of this repo entirely
// (AGENTS_TO_DO.md, 2026-08-02 - same "CORE чистим і порожнім" decision
// as migration 044's active-buzzer removal, right beside it). No runner
// remains in this repo's own apps/orchestrator for this kind any more
// (apps/orchestrator/src/processes/alarmAnnunciator.ts deleted, its
// registerBuiltinProcessKinds() entry removed) - unconditional removal,
// same reasoning as migrations 035/044.
//
// The node + 17 devices seeded by migration 043 are UNTOUCHED here -
// confirmed explicitly with the user ("Нода і пристрої залишаються в
// CORE library"): the physical panel design stays a real, always-
// available Library instance in the base platform; only the process
// (which Message Groups actually matter - inherently a target-project
// concern) moves out. nexus-edge-smart-house now owns that recipe
// (`plugins/alarm-annunciator/process.ts` +
// `migrations/004_seed_alarm_annunciator_process.sql`), referencing
// these same devices by name - safe because, unlike active-buzzer-01,
// migration 043 was never gated behind SEED_DEMO_FIXTURES.
export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    DELETE FROM processes
    WHERE kind = 'alarm-annunciator'
      AND device_id = (SELECT id FROM devices WHERE name = 'annunciator-buzzer-01')
  `);
  pgm.sql(`
    DELETE FROM process_groups
    WHERE name = 'System' AND NOT EXISTS (SELECT 1 FROM processes WHERE group_id = process_groups.id)
  `);
};

// Deliberately no-op, same reasoning as migrations 034/035/044's down().
export const down = (): void => {};
