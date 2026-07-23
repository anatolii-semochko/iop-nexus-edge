import type { MigrationBuilder } from "node-pg-migrate";

// Registers the smoke-test virtual device already provisioned in EdgeX by
// apps/device-service (see its res/devices/example-devices.yaml) as a
// standalone (no node) Device Registry row, so the Devices API/UI have a
// real record to show. Remove once real device types replace it (see
// AGENTS.md section 7).
const DEVICE_NAME = "example-virtual-sensor-01";

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    INSERT INTO devices (type, name, backend, edgex_device_name, capabilities)
    VALUES (
      'NexusEdge-Example-Virtual',
      '${DEVICE_NAME}',
      'virtual',
      '${DEVICE_NAME}',
      '{"resources": ["Switch", "Temperature"]}'::jsonb
    )
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DELETE FROM devices WHERE name = '${DEVICE_NAME}'`);
};
