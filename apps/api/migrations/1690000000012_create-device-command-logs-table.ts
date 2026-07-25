import type { MigrationBuilder } from "node-pg-migrate";

// Audit trail of every write sent through the Devices API's four mutating
// endpoints (write/auto/release/simulate - routes/devices.ts), regardless
// of whether it came from a human (UI) or the orchestrator - both are
// "commands", just with a different `source`. Append-only: no updated_at,
// nothing here is ever edited after the fact. `device_id` is nullable/
// ON DELETE SET NULL for the same reason processes.device_id is - the log
// entry should survive the device being removed, not vanish with it.
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable("device_command_logs", {
    id: "id",
    device_id: {
      type: "integer",
      references: '"devices"',
      onDelete: "SET NULL",
    },
    resource: { type: "text", notNull: true },
    // Which of the four routes issued this - not a generic "type" since
    // there's no plugin system here, just these four fixed actions.
    action: {
      type: "text",
      notNull: true,
      check: "action in ('write', 'auto', 'release', 'simulate')",
    },
    // Null for "release" (no body) - jsonb rather than a typed column
    // since a resource's value can be bool/number/string depending on
    // its capability, same "loose, interpreted by the consumer" approach
    // as devices.capabilities/processes.config.
    value: { type: "jsonb" },
    source: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createIndex("device_command_logs", "device_id");
  pgm.createIndex("device_command_logs", "created_at");
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable("device_command_logs");
};
