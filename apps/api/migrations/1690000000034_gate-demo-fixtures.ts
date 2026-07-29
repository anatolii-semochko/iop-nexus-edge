import type { MigrationBuilder } from "node-pg-migrate";

// "Chistiy proekt" decision (to-do.txt 2026-07-29). Device TYPES
// (light-regulator, active-buzzer, temperature/heater/cooler/switch)
// stay in the public Library (devices/) either way - only the specific
// PROVISIONED INSTANCES these earlier migrations (005, 023-024, 031,
// 033) seeded are demo/dev convenience, not something every target
// project should inherit unconditionally. A clean target project adds
// and registers Library components itself (AGENTS.md section 31's
// extension points), it doesn't start with them already present.
//
// Schema-creating migrations and genuinely base SYSTEM process seeds
// (011 resource-monitor, 026's heartbeat-control half) are untouched -
// those ship in every project, nexus-edge's own local dev included.
// heartbeat-control-test (026's other half) is a test fixture, gated
// alongside the device demos, not a base system process.
//
// SEED_DEMO_FIXTURES=true (nexus-edge's own local .env only) - no-op,
// leaves the earlier migrations' rows exactly as seeded. Unset/false
// (.env.example default, every target project) - deletes them. Works
// identically whether this runs on a brand new database (same `up`
// pass that just inserted them) or an existing one that already had
// them from before this migration existed (e.g. nexus-edge-smart-house's
// own database, which inherited nexus-edge's full migration history
// unconditionally until now).
export const up = (pgm: MigrationBuilder): void => {
  if (process.env.SEED_DEMO_FIXTURES === "true") return;

  pgm.sql(`
    DELETE FROM processes
    WHERE kind IN ('temperature-control', 'temperature-monitor', 'active-buzzer', 'heartbeat-control-test')
  `);
  pgm.sql(`
    DELETE FROM devices
    WHERE name IN (
      'light-regulator-01', 'active-buzzer-01',
      'example-temperature-01', 'example-heater-01', 'example-cooler-01', 'example-switch-01'
    )
  `);
  pgm.sql(`DELETE FROM nodes WHERE name = 'example-thermal-node-01'`);
  pgm.sql(`
    DELETE FROM process_groups
    WHERE name IN ('System', 'Test', 'Temperature Control')
      AND NOT EXISTS (SELECT 1 FROM processes WHERE group_id = process_groups.id)
  `);
};

// Deliberately no-op: this migration's only job is "make the database
// match SEED_DEMO_FIXTURES" - rolling back and re-running `up` already
// re-evaluates the flag, no separate re-seed logic needed here (the
// original rows, if ever wanted back, come from re-running 005/023/024/
// 031/033's own down()+up() or a fresh `up` with the flag set).
export const down = (): void => {};
