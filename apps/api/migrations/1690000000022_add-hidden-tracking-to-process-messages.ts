import type { MigrationBuilder } from "node-pg-migrate";

// Notification center (AGENTS.md section 25) - the "hidden" flag on
// process_messages already meant "acknowledged, stop showing it" for
// type="message" (section 22). This adds who/when to that same action,
// and the notification center reuses it as the read/unread marker across
// all three types (message/warning/error), not just message - dismissing
// an entry there is the same act as dismissing it anywhere else.
// `hidden_by` is nullable and ON DELETE SET NULL, not RESTRICT - a deleted
// user's past read-marks stay on the historical record, just anonymized.
export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumn("process_messages", {
    hidden_by: {
      type: "integer",
      references: "users",
      onDelete: "SET NULL",
    },
    hidden_at: { type: "timestamptz" },
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropColumn("process_messages", ["hidden_by", "hidden_at"]);
};
