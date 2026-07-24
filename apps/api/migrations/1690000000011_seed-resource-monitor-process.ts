import type { MigrationBuilder } from "node-pg-migrate";

// Permanent host resource-monitor process (AGENTS.md section 21) - CPU/RAM/
// disk load, checked by apps/orchestrator/src/processes/resourceMonitor.ts.
// No device_id: it watches the host the orchestrator runs on, not an EdgeX
// device, and that column is already nullable for exactly this reason (see
// process_groups' own ON DELETE SET NULL). Thresholds are percentages,
// loose jsonb like every other kind's config - `*Max` raises `critical`
// (red row), `*WarnMax` raises `warning` (yellow row) when past it but
// still under `*Max`. A threshold of 0 disables that particular check.
export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`INSERT INTO process_groups (name) VALUES ('System') ON CONFLICT (name) DO NOTHING`);

  pgm.sql(`
    INSERT INTO processes (name, group_id, type, kind, actions, device_id, config)
    VALUES (
      'Resource Monitor',
      (SELECT id FROM process_groups WHERE name = 'System'),
      'permanent',
      'resource-monitor',
      ARRAY[]::text[],
      NULL,
      '{"cpuMax": 85, "ramMax": 85, "diskMax": 90, "cpuWarnMax": 70, "ramWarnMax": 70, "diskWarnMax": 75}'::jsonb
    )
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DELETE FROM processes WHERE kind = 'resource-monitor'`);
  pgm.sql(`
    DELETE FROM process_groups
    WHERE name = 'System' AND NOT EXISTS (SELECT 1 FROM processes WHERE group_id = process_groups.id)
  `);
};
