import type { MigrationBuilder } from "node-pg-migrate";

// Renames the three log tables to their final names (AGENTS_TO_DO.md's
// 2026-07-27 Device/Node refactor, direct instruction: "Потрібно існуючі
// таблиці ... перейменувати + підлаштувати ... Ну, і всю інфраструктуру"):
// sensor_reading_logs -> log_device, device_command_logs -> log_command,
// process_messages -> log_messages. Sequences/indexes/constraints are
// renamed to match explicitly - a plain ALTER TABLE ... RENAME TO does not
// rename any of those on its own, and leaving e.g. a `log_device` table
// backed by a `sensor_reading_logs_id_seq` sequence would be exactly the
// kind of confusing half-renamed state this refactor is trying to get rid
// of elsewhere.
//
// `resource` is dropped from BOTH log_device and log_command here, not
// only log_device as the roadmap's Phase 2.6 heading literally named - the
// same reasoning applies to both (a Device is atomic now, `resource` is
// redundant with `device_id`), and Phase 3.5's planned code change
// ("прибрати параметр resource з усіх функцій (list*/log*)" for BOTH
// deviceCommandLog.ts and sensorReadingLog.ts) already assumed this - the
// column has to go now for that code change to be possible at all
// (device_command_logs.resource is NOT NULL). log_messages has no
// device/resource dimension at all (keyed by process_id) - rename only.
export const up = (pgm: MigrationBuilder): void => {
  // sensor_reading_logs -> log_device
  pgm.renameTable("sensor_reading_logs", "log_device");
  pgm.sql(`ALTER TABLE log_device RENAME CONSTRAINT sensor_reading_logs_pkey TO log_device_pkey`);
  pgm.sql(
    `ALTER TABLE log_device RENAME CONSTRAINT sensor_reading_logs_device_id_fkey TO log_device_device_id_fkey`,
  );
  pgm.sql(`ALTER INDEX sensor_reading_logs_created_at_index RENAME TO log_device_created_at_index`);
  pgm.sql(`ALTER INDEX sensor_reading_logs_device_id_index RENAME TO log_device_device_id_index`);
  pgm.sql(`ALTER SEQUENCE sensor_reading_logs_id_seq RENAME TO log_device_id_seq`);
  pgm.dropColumn("log_device", "resource");

  // device_command_logs -> log_command
  pgm.renameTable("device_command_logs", "log_command");
  pgm.sql(`ALTER TABLE log_command RENAME CONSTRAINT device_command_logs_pkey TO log_command_pkey`);
  pgm.sql(
    `ALTER TABLE log_command RENAME CONSTRAINT device_command_logs_device_id_fkey TO log_command_device_id_fkey`,
  );
  pgm.sql(
    `ALTER TABLE log_command RENAME CONSTRAINT device_command_logs_action_check TO log_command_action_check`,
  );
  pgm.sql(`ALTER INDEX device_command_logs_created_at_index RENAME TO log_command_created_at_index`);
  pgm.sql(`ALTER INDEX device_command_logs_device_id_index RENAME TO log_command_device_id_index`);
  pgm.sql(`ALTER SEQUENCE device_command_logs_id_seq RENAME TO log_command_id_seq`);
  pgm.dropColumn("log_command", "resource");

  // process_messages -> log_messages
  pgm.renameTable("process_messages", "log_messages");
  pgm.sql(`ALTER TABLE log_messages RENAME CONSTRAINT process_messages_pkey TO log_messages_pkey`);
  pgm.sql(
    `ALTER TABLE log_messages RENAME CONSTRAINT process_messages_hidden_by_fkey TO log_messages_hidden_by_fkey`,
  );
  pgm.sql(
    `ALTER TABLE log_messages RENAME CONSTRAINT process_messages_process_id_fkey TO log_messages_process_id_fkey`,
  );
  pgm.sql(`ALTER TABLE log_messages RENAME CONSTRAINT process_messages_type_check TO log_messages_type_check`);
  pgm.sql(`ALTER INDEX process_messages_process_id_index RENAME TO log_messages_process_id_index`);
  pgm.sql(
    `ALTER INDEX process_messages_process_id_type_code_unique_index RENAME TO log_messages_process_id_type_code_unique_index`,
  );
  pgm.sql(`ALTER INDEX process_messages_created_at_index RENAME TO log_messages_created_at_index`);
  pgm.sql(`ALTER SEQUENCE process_messages_id_seq RENAME TO log_messages_id_seq`);
};

export const down = (pgm: MigrationBuilder): void => {
  // log_messages -> process_messages
  pgm.sql(`ALTER SEQUENCE log_messages_id_seq RENAME TO process_messages_id_seq`);
  pgm.sql(`ALTER INDEX log_messages_created_at_index RENAME TO process_messages_created_at_index`);
  pgm.sql(
    `ALTER INDEX log_messages_process_id_type_code_unique_index RENAME TO process_messages_process_id_type_code_unique_index`,
  );
  pgm.sql(`ALTER INDEX log_messages_process_id_index RENAME TO process_messages_process_id_index`);
  pgm.sql(`ALTER TABLE log_messages RENAME CONSTRAINT log_messages_type_check TO process_messages_type_check`);
  pgm.sql(
    `ALTER TABLE log_messages RENAME CONSTRAINT log_messages_process_id_fkey TO process_messages_process_id_fkey`,
  );
  pgm.sql(
    `ALTER TABLE log_messages RENAME CONSTRAINT log_messages_hidden_by_fkey TO process_messages_hidden_by_fkey`,
  );
  pgm.sql(`ALTER TABLE log_messages RENAME CONSTRAINT log_messages_pkey TO process_messages_pkey`);
  pgm.renameTable("log_messages", "process_messages");

  // log_command -> device_command_logs
  pgm.addColumn("log_command", { resource: { type: "text" } });
  pgm.sql(`ALTER SEQUENCE log_command_id_seq RENAME TO device_command_logs_id_seq`);
  pgm.sql(`ALTER INDEX log_command_device_id_index RENAME TO device_command_logs_device_id_index`);
  pgm.sql(`ALTER INDEX log_command_created_at_index RENAME TO device_command_logs_created_at_index`);
  pgm.sql(
    `ALTER TABLE log_command RENAME CONSTRAINT log_command_action_check TO device_command_logs_action_check`,
  );
  pgm.sql(
    `ALTER TABLE log_command RENAME CONSTRAINT log_command_device_id_fkey TO device_command_logs_device_id_fkey`,
  );
  pgm.sql(`ALTER TABLE log_command RENAME CONSTRAINT log_command_pkey TO device_command_logs_pkey`);
  pgm.renameTable("log_command", "device_command_logs");

  // log_device -> sensor_reading_logs
  pgm.addColumn("log_device", { resource: { type: "text" } });
  pgm.sql(`ALTER SEQUENCE log_device_id_seq RENAME TO sensor_reading_logs_id_seq`);
  pgm.sql(`ALTER INDEX log_device_device_id_index RENAME TO sensor_reading_logs_device_id_index`);
  pgm.sql(`ALTER INDEX log_device_created_at_index RENAME TO sensor_reading_logs_created_at_index`);
  pgm.sql(
    `ALTER TABLE log_device RENAME CONSTRAINT log_device_device_id_fkey TO sensor_reading_logs_device_id_fkey`,
  );
  pgm.sql(`ALTER TABLE log_device RENAME CONSTRAINT log_device_pkey TO sensor_reading_logs_pkey`);
  pgm.renameTable("log_device", "sensor_reading_logs");
};
