import type { MigrationBuilder } from "node-pg-migrate";

// "active-buzzer" process CODE moved out of this repo entirely
// (AGENTS_TO_DO.md, 2026-08-02 - "CORE ми хочемо мати чистим і порожнім"
// decision) - same reasoning as migration 035's temperature-control
// removal: there is no runner left in this repo's own apps/orchestrator
// for this kind at all any more (deleted alongside this migration -
// apps/orchestrator/src/processes/activeBuzzer.ts, its
// registerBuiltinProcessKinds() entry). Seeding the process row even
// with SEED_DEMO_FIXTURES=true would leave a dead, frozen row - the
// orchestrator silently skips a kind with no registered runner - so
// this removal is unconditional, matching migration 035's own
// reasoning exactly.
//
// The device itself (`active-buzzer-01`) is untouched here - only the
// process row goes. Device *types* (and this specific demo instance,
// gated behind SEED_DEMO_FIXTURES since migration 034) stay in the
// public Library either way; a target project that wants a working
// buzzer seeds its own fresh instance + process (nexus-edge-smart-house
// now does exactly this, `plugins/active-buzzer/process.ts` +
// `migrations/002_seed_house_buzzer.sql`).
//
// Scoped by `device_id`, not a bare `WHERE kind = 'active-buzzer'` -
// migration 035's own postmortem (its "EDITED same day" note) is the
// reason: `kind` is a shared process-plugin dispatch key, a target
// project can legitimately have its own same-kind row. Scoping to the
// specific device this repo's own migration 023 created means this
// only ever touches nexus-edge's own row, never a target project's.
export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    DELETE FROM processes
    WHERE kind = 'active-buzzer'
      AND device_id = (SELECT id FROM devices WHERE name = 'active-buzzer-01')
  `);
  pgm.sql(`
    DELETE FROM process_groups
    WHERE name = 'System' AND NOT EXISTS (SELECT 1 FROM processes WHERE group_id = process_groups.id)
  `);
};

// Deliberately no-op, same reasoning as migrations 034/035's down().
export const down = (): void => {};
