import type { MigrationBuilder } from "node-pg-migrate";

// Registers the Light Regulator (devices/standalone/actuator/light-regulator/,
// AGENTS.md section 7) - the platform's first real device type - as a
// standalone (no node) Device Registry row. Provisioned into EdgeX by
// apps/device-service (see its res/devices/light-regulator-devices.yaml).
// Single readOnly resource: a pure sensor, no AUTO/MANUAL mode at all (see
// the ResourceCapability comment in apps/api/src/routes/devices.ts).
const DEVICE_NAME = "light-regulator-01";

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    INSERT INTO devices (type, name, backend, edgex_device_name, capabilities)
    VALUES (
      'light-regulator',
      '${DEVICE_NAME}',
      'virtual',
      '${DEVICE_NAME}',
      '{"resources": [{"name": "Level", "readOnly": true, "min": 0, "max": 100, "step": 1}]}'::jsonb
    )
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DELETE FROM devices WHERE name = '${DEVICE_NAME}'`);
};
