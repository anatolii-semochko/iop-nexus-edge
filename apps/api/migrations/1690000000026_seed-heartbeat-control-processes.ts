import type { MigrationBuilder } from "node-pg-migrate";

// "Heartbeating Control" - the permanent system process that watches
// every monitored entity's heartbeat (processes only in this first pass -
// AGENTS.md's Heartbeating Control section) and raises WEM entries under
// its OWN process_id when one goes stale, not under the stale entity's
// own id: `process_messages` has no FK for devices/nodes at all, and a
// process whose own runner is genuinely broken can't reliably report its
// own staleness (that's the entire point of an independent watchdog) -
// confirmed with the user before building this.
//
// "Heartbeating control test" - a dummy PERMANENT process (not
// controllable - confirmed with the user after an earlier draft wrongly
// reused the generic ON/OFF status mechanism here, which also suffered
// visible lag since `status` is a deliberately non-urgent, timer-only
// broadcast field). Its own internal simulate-failure flag is a bespoke
// piece of state (`heartbeat:test:{id}:simulateFailure` in Redis, see
// apps/api/src/heartbeatControl.ts), toggled from a switch *inside* its
// own expandable detail panel, with the panel managing that switch's
// visual state optimistically/locally rather than waiting on any
// broadcast - so "Heartbeating Control"'s actual warning/error escalation
// can be exercised on demand, instantly, without touching any real
// monitored process. Also `stoppable: true` (the only entity seeded that
// way) - independent of the simulate-failure flag, its general heartbeat
// *monitoring* can also be paused from the combined list, for testing
// that separate mechanism too.
export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`INSERT INTO process_groups (name) VALUES ('Test') ON CONFLICT (name) DO NOTHING`);

  pgm.sql(`
    INSERT INTO processes (name, group_id, type, kind, actions, device_id, config, heartbeat_control)
    VALUES (
      'Heartbeating Control',
      (SELECT id FROM process_groups WHERE name = 'System'),
      'permanent',
      'heartbeat-control',
      ARRAY[]::text[],
      NULL,
      '{}'::jsonb,
      '{"stoppable": false, "warning": {"numberSkippedTicks": 3, "level": 1}, "error": {"numberSkippedTicks": 10, "level": 1}}'::jsonb
    )
  `);

  pgm.sql(`
    INSERT INTO processes (name, group_id, type, kind, actions, device_id, config, heartbeat_control)
    VALUES (
      'Heartbeating control test',
      (SELECT id FROM process_groups WHERE name = 'Test'),
      'permanent',
      'heartbeat-control-test',
      ARRAY[]::text[],
      NULL,
      '{}'::jsonb,
      '{"stoppable": true, "warning": {"numberSkippedTicks": 3, "level": 1}, "error": {"numberSkippedTicks": 10, "level": 1}}'::jsonb
    )
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DELETE FROM processes WHERE kind IN ('heartbeat-control', 'heartbeat-control-test')`);
  pgm.sql(`
    DELETE FROM process_groups
    WHERE name = 'Test' AND NOT EXISTS (SELECT 1 FROM processes WHERE group_id = process_groups.id)
  `);
};
