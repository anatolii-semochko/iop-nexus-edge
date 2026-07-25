import type { MigrationBuilder } from "node-pg-migrate";

// WEM (Warnings/Errors/Messages) - a process's active/historical
// notifications, layered alongside its existing `critical`/`warning`
// Redis flags (processRegistry.ts), not a replacement for them. Unlike
// device_command_logs/sensor_reading_logs (pure append-only), a row here
// has a lifecycle: `resolved_at IS NULL` means still active/ongoing
// ("поки не зникли" - shown until it disappears); a process reporting the
// same `code` again while already active must NOT insert a duplicate row
// (see processMessages.syncActiveMessages, the shared dedup mechanism) -
// the partial unique index below enforces that invariant at the DB level
// too, not just in application code.
//
// `code` is a stable machine identifier for *which* specific condition
// this is (e.g. "cpu_error", "temperature_out_of_range") - what
// syncActiveMessages actually compares to decide "is this the same
// warning as before or a new one", independent of `text`'s human-readable
// wording (which may include a current reading, e.g. "CPU at 92%", and so
// isn't itself stable enough to dedup on).
//
// `hidden` is a single global flag (confirmed with the user - not
// per-user; whoever hides it, it's hidden for everyone), separate from
// `resolved_at` - a resolved message can still be shown until a user
// dismisses it, and an unresolved one can be hidden early if desired.
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable("process_messages", {
    id: "id",
    process_id: {
      type: "integer",
      notNull: true,
      references: '"processes"',
      onDelete: "CASCADE",
    },
    type: {
      type: "text",
      notNull: true,
      check: "type in ('warning', 'error', 'message')",
    },
    level: { type: "integer", notNull: true },
    code: { type: "text", notNull: true },
    text: { type: "text", notNull: true },
    hidden: { type: "boolean", notNull: true, default: false },
    resolved_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createIndex("process_messages", "process_id");
  pgm.createIndex("process_messages", ["process_id", "type", "code"], {
    unique: true,
    where: "resolved_at IS NULL",
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable("process_messages");
};
