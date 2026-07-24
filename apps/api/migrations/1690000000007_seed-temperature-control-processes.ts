import type { MigrationBuilder } from "node-pg-migrate";

// First two real processes (AGENTS.md section 10): a controllable process
// that actively drives Cooler/Heater on example-virtual-sensor-01 within
// its own min/max, and a permanent one that independently watches the same
// device with a *wider* safety margin and raises a critical flag if the
// controllable process's actuation ever fails to keep it in range - or if
// Cooler and Heater are ever both active at once (defense-in-depth: the
// Model State Validator already forbids writing that combination, this
// catches it even if something else caused it). `linkedProcessIds` on the
// monitor names every process whose table row should highlight when it
// raises critical - both itself and the controllable process it's
// watching, computed here rather than hardcoded so it doesn't depend on
// guessing serial ids.
export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    INSERT INTO processes (name, group_name, type, kind, actions, device_id, config)
    VALUES (
      'Temperature Control',
      'Temperature Control',
      'controllable',
      'temperature-control',
      ARRAY['ON', 'OFF'],
      (SELECT id FROM devices WHERE name = 'example-virtual-sensor-01'),
      '{"min": 18, "max": 25}'::jsonb
    )
  `);

  pgm.sql(`
    INSERT INTO processes (name, group_name, type, kind, actions, device_id, config)
    VALUES (
      'Temperature Safety Monitor',
      'Temperature Control',
      'permanent',
      'temperature-monitor',
      ARRAY[]::text[],
      (SELECT id FROM devices WHERE name = 'example-virtual-sensor-01'),
      '{"min": 15, "max": 28}'::jsonb
    )
  `);

  pgm.sql(`
    UPDATE processes
    SET config = config || jsonb_build_object(
      'linkedProcessIds',
      (SELECT jsonb_agg(id) FROM processes WHERE kind IN ('temperature-control', 'temperature-monitor'))
    )
    WHERE kind = 'temperature-monitor'
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DELETE FROM processes WHERE kind IN ('temperature-control', 'temperature-monitor')`);
};
