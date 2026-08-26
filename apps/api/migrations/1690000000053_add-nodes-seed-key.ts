import type { MigrationBuilder } from "node-pg-migrate";

// Nodes have no stable, non-user-editable identity column the way a
// Device has `edgex_device_name` (AGENTS_TO_DO.md, 2026-08-23 - real bug:
// target-project seed migrations matched a node via `ON CONFLICT (name)`,
// but `name` is user-renameable via `PATCH /nodes/:id/name` - once a
// seeded node got renamed, the next `migrate-extra` re-run (e.g. any
// container rebuild) no longer matched it and silently inserted a fresh
// duplicate node instead of recognizing the existing one, exactly the
// class of bug `devices.edgex_device_name` already exists to avoid for
// Devices). `seed_key` is the Node-level equivalent: a nullable,
// unique, never-shown-in-the-UI anchor that only a seed migration's own
// `ON CONFLICT (seed_key)` ever reads or writes - `name` stays exactly
// as freely renameable as it always has been.
export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumn("nodes", {
    seed_key: { type: "text", unique: true },
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropColumn("nodes", "seed_key");
};
