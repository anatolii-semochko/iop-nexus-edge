import type { MigrationBuilder } from "node-pg-migrate";

// Data Logger (AGENTS.md's Heartbeating Control section used as the
// architectural template, confirmed with the user before building this) -
// a permanent System process that decides what/when to log to
// `log_device`, closing the gap left by the Device/Node refactor's
// deliberate removal of the old unconditional per-tick write (see
// dualDevicesModel.ts's publishReading comment).
//
// Config lives on `devices` itself (same loose-jsonb convention as
// `heartbeat_control`/`capabilities`), Devices only - Nodes have no
// `value` of their own (a Device is atomic, exactly one value - the
// whole point of the Device/Node refactor), confirmed with the user.
// Shape:
//   { writeEnabled: boolean,
//     periodSeconds: number | null,
//     warning: { numberSkippedPeriods: number, level: number } | null,
//     error:   { numberSkippedPeriods: number, level: number } | null }
// `periodSeconds` null means "not configured" - `writeEnabled` is then
// forced false server-side (routes/dataLoggerControls.ts), matching the
// user's explicit spec ("може бути порожнім - свічер OFF+disable").
// `numberSkippedPeriods` counts overdue PERIODS OF THIS DEVICE'S OWN
// `periodSeconds` (confirmed with the user - not raw system ticks, unlike
// Heartbeating Control's `numberSkippedTicks`). `level` refers to
// `message_levels` (1-4), same WEM pipeline as every other warning/error
// producer - no new alerting mechanism.
//
// The "Data Logger" process itself carries two global switches in its own
// `config` (same place temperature-control keeps min/max) rather than a
// new dedicated table, since there are exactly two booleans and they
// belong to this one process:
//   { errorWarningEnabled: boolean, tickLoggingEnabled: boolean }
// - `errorWarningEnabled` (default true): master gate for whether overdue
//   devices raise warning/error WEM at all.
// - `tickLoggingEnabled` (default false): guards against the exact
//   problem the old unconditional per-tick write caused (the user
//   recalled "thousands of records") - a device configured with
//   `periodSeconds` at or below one tick is simply skipped by the
//   orchestrator runner while this is off, regardless of `writeEnabled`;
//   turning it on is meant for a deliberately chosen few critical
//   devices, not a blanket switch.
const DEFAULT_DATA_LOGGER_CONTROL = {
  writeEnabled: false,
  periodSeconds: null,
  warning: { numberSkippedPeriods: 1, level: 1 },
  error: { numberSkippedPeriods: 2, level: 1 },
};

export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumn("devices", {
    data_logger_control: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
  });
  pgm.sql(`UPDATE devices SET data_logger_control = '${JSON.stringify(DEFAULT_DATA_LOGGER_CONTROL)}'::jsonb`);

  pgm.sql(`
    INSERT INTO processes (name, group_id, type, kind, actions, device_id, config)
    VALUES (
      'Data Logger',
      (SELECT id FROM process_groups WHERE name = 'System'),
      'permanent',
      'data-logger',
      ARRAY[]::text[],
      NULL,
      '{"errorWarningEnabled": true, "tickLoggingEnabled": false}'::jsonb
    )
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DELETE FROM processes WHERE kind = 'data-logger'`);
  pgm.dropColumn("devices", "data_logger_control");
};
