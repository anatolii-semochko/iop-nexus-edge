import type { MigrationBuilder } from "node-pg-migrate";

// Heartbeating (AGENTS.md's Heartbeating Control section) - the config
// belongs to each entity itself (confirmed with the user, explicitly NOT
// a separate cross-entity table - "вони належать їм і будуть розширювати
// для іншого функціоналу"), same loose-jsonb convention already used for
// `processes.config`/`devices.capabilities`. Shape:
//   { stoppable: boolean,
//     warning: { numberSkippedTicks: number, level: number } | null,
//     error:   { numberSkippedTicks: number, level: number } | null }
// `stoppable` is system-set, never accepted from the edit UI (only
// warning/error are user-editable) - see routes/heartbeatControls.ts.
// `level` refers to the existing warning/error rows in `message_levels`
// (1-4) - a stale entity becomes just another WEM producer into the same
// pipeline Active Zummer already consumes, no new alerting mechanism.
//
// Seeded conservative defaults on every existing row: `stoppable: false`
// (only the dedicated "Heartbeating control test" process, seeded in the
// next migration, is meant to be pausable - see AGENTS.md), 3 skipped
// ticks -> warning/1, 10 skipped ticks -> error/1 (1 tick = 1s, the
// platform's base heartbeat period). Real staleness detection is only
// wired up for processes in this first pass (they have a natural 1s tick
// driver already - devices/nodes don't yet), but every entity type gets
// the column/config now so the combined UI list and edit form work
// uniformly - see the user's own explicit scoping decision.
const DEFAULT_HEARTBEAT_CONTROL = {
  stoppable: false,
  warning: { numberSkippedTicks: 3, level: 1 },
  error: { numberSkippedTicks: 10, level: 1 },
};

export const up = async (pgm: MigrationBuilder): Promise<void> => {
  for (const table of ["processes", "devices", "nodes"] as const) {
    pgm.addColumn(table, {
      heartbeat_control: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    });
  }

  pgm.sql(`UPDATE processes SET heartbeat_control = '${JSON.stringify(DEFAULT_HEARTBEAT_CONTROL)}'::jsonb`);
  pgm.sql(`UPDATE devices SET heartbeat_control = '${JSON.stringify(DEFAULT_HEARTBEAT_CONTROL)}'::jsonb`);
  // No nodes exist yet (standalone-only devices so far) - nothing to backfill.
};

export const down = (pgm: MigrationBuilder): void => {
  for (const table of ["processes", "devices", "nodes"] as const) {
    pgm.dropColumn(table, "heartbeat_control");
  }
};
