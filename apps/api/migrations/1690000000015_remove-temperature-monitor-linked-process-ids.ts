import type { MigrationBuilder } from "node-pg-migrate";

// Removes the `linkedProcessIds` config key from the seeded temperature-
// monitor process (AGENTS.md section 10/22). That key drove a cross-
// process critical-propagation kludge (a monitor's own critical flag
// forced the controllable process it watches into critical too) built
// before WEM existed and flagged by the user as debt that didn't fit the
// intended architecture - apps/orchestrator/src/processes/
// temperatureMonitor.ts no longer reads this key at all, so the stale
// value is dropped from Postgres too rather than left as unused jsonb.
export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    UPDATE processes
    SET config = config - 'linkedProcessIds'
    WHERE kind = 'temperature-monitor'
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    UPDATE processes
    SET config = config || jsonb_build_object(
      'linkedProcessIds',
      (SELECT jsonb_agg(id) FROM processes WHERE kind IN ('temperature-control', 'temperature-monitor'))
    )
    WHERE kind = 'temperature-monitor'
  `);
};
