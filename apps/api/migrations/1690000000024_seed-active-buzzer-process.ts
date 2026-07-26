import type { MigrationBuilder } from "node-pg-migrate";

// "Active Zummer" - the platform's first sound-output process (AGENTS.md's
// Active Zummer section). Controllable (ON/OFF), same shape as
// temperature-control: an operator can silence/enable the whole feature,
// but *when* it sounds and in what pattern is decided every tick by
// apps/orchestrator/src/processes/activeBuzzer.ts from the fleet's
// error/warning state plus the existing Message Levels config (error
// level 1 / warning level 1 for now - AGENTS.md section 22/23). No
// process-level config of its own (unlike temperature-control's min/max) -
// the alarm policy lives entirely in message_levels, shared across every
// future sound-output process, not duplicated per-process here.
export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`INSERT INTO process_groups (name) VALUES ('System') ON CONFLICT (name) DO NOTHING`);

  pgm.sql(`
    INSERT INTO processes (name, group_id, type, kind, actions, device_id, config)
    VALUES (
      'Active Zummer',
      (SELECT id FROM process_groups WHERE name = 'System'),
      'controllable',
      'active-buzzer',
      ARRAY['ON', 'OFF'],
      (SELECT id FROM devices WHERE name = 'active-buzzer-01'),
      '{}'::jsonb
    )
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DELETE FROM processes WHERE kind = 'active-buzzer'`);
  pgm.sql(`
    DELETE FROM process_groups
    WHERE name = 'System' AND NOT EXISTS (SELECT 1 FROM processes WHERE group_id = process_groups.id)
  `);
};
