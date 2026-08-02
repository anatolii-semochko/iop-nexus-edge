import type { MigrationBuilder } from "node-pg-migrate";

// Registers the Active Zummer (devices/standalone/indicator/active-buzzer/, AGENTS.md
// section 7) - a single binary actuator, not a sensor: `readOnly` is
// deliberately absent from its capability (defaults falsy), unlike
// light-regulator's read-only `Level`. Provisioned into EdgeX by
// apps/device-service (see its res/devices/active-buzzer-devices.yaml).
const DEVICE_NAME = "active-buzzer-01";

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    INSERT INTO devices (type, name, backend, edgex_device_name, capabilities)
    VALUES (
      'active-buzzer',
      '${DEVICE_NAME}',
      'virtual',
      '${DEVICE_NAME}',
      '{"resources": [{"name": "Buzzer"}]}'::jsonb
    )
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DELETE FROM devices WHERE name = '${DEVICE_NAME}'`);
};
