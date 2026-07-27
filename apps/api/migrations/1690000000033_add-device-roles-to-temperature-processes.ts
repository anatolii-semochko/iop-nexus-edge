import type { MigrationBuilder } from "node-pg-migrate";

// Temperature Control/Safety Monitor drove Cooler/Heater on a single
// bundled device via (deviceId, resource) before the 2026-07-27 Device/
// Node refactor (migration ...031 already split that into three separate
// atomic Devices on one Node). Adds the role -> deviceId mapping these two
// process kinds need now (apps/orchestrator's temperatureControl.ts/
// temperatureMonitor.ts, roadmap Phase 4.1) - same "loose jsonb,
// interpreted by the consumer" approach `config` already uses (e.g.
// heartbeat_control). Looked up by device name within the node rather
// than hardcoded ids, so this doesn't depend on migration ...031's exact
// serial values. Existing `min`/`max` in `config` are preserved (merged
// in, not overwritten).
export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    UPDATE processes
    SET config = config || jsonb_build_object(
      'sensorDeviceId', (SELECT id FROM devices WHERE node_id = processes.node_id AND name = 'example-temperature-01'),
      'heaterDeviceId', (SELECT id FROM devices WHERE node_id = processes.node_id AND name = 'example-heater-01'),
      'coolerDeviceId', (SELECT id FROM devices WHERE node_id = processes.node_id AND name = 'example-cooler-01')
    )
    WHERE kind IN ('temperature-control', 'temperature-monitor')
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    UPDATE processes
    SET config = config - 'sensorDeviceId' - 'heaterDeviceId' - 'coolerDeviceId'
    WHERE kind IN ('temperature-control', 'temperature-monitor')
  `);
};
