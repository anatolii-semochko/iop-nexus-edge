import type { MigrationBuilder } from "node-pg-migrate";

// Time series of every readOnly (sensor) resource value that's ever been
// published (dualDevicesModel.publishReading) - deliberately hooked at
// that single function rather than at the /simulate route that's its only
// caller today, so a future real EdgeX push/poll path logs here too
// without needing to remember to call this separately. No filtering yet -
// every reading is logged unconditionally ("хардкодимо, пропускаємо все" -
// a future `sensor_log_filters`-style table can gate this down once the
// write volume actually becomes a problem on constrained hardware, not
// attempted here). Append-only, same as device_command_logs.
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable("sensor_reading_logs", {
    id: "id",
    device_id: {
      type: "integer",
      references: '"devices"',
      onDelete: "SET NULL",
    },
    resource: { type: "text", notNull: true },
    value: { type: "jsonb", notNull: true },
    source: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createIndex("sensor_reading_logs", "device_id");
  pgm.createIndex("sensor_reading_logs", "created_at");
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable("sensor_reading_logs");
};
