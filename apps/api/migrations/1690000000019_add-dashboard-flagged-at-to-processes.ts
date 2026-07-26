import type { MigrationBuilder } from "node-pg-migrate";

// Dashboard tab (AGENTS.md section 22) - a process is flagged the moment it
// first gets an active WEM entry (processMessages.maybeFlagForDashboard),
// and stays flagged - shown on the Dashboard tab - until a user explicitly
// clears it (only once it currently has zero active entries again). Global,
// not per-user, same reasoning as `process_messages.hidden`.
export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumn("processes", {
    dashboard_flagged_at: { type: "timestamptz" },
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropColumn("processes", "dashboard_flagged_at");
};
