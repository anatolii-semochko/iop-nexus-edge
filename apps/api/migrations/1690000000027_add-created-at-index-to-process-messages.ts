import type { MigrationBuilder } from "node-pg-migrate";

// The Logs page (processes tab) filters/sorts this table by date range on
// top of the notification center's existing type/scope/processId/search -
// device_command_logs and sensor_reading_logs already had this index from
// their own creation migrations, process_messages was missing it (its only
// consumer until now, the notification center, never needed a date range).
export const up = (pgm: MigrationBuilder): void => {
  pgm.createIndex("process_messages", "created_at");
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropIndex("process_messages", "created_at");
};
