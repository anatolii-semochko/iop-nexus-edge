import type { MigrationBuilder } from "node-pg-migrate";

// `capabilities.resources` moves from a flat string[] to an array of
// {name, readOnly?, min?, max?, step?} descriptors (see the
// ResourceCapability comment in apps/api/src/routes/devices.ts) - needed to
// represent a pure sensor with no AUTO/MANUAL concept at all (AGENTS.md
// section 6/7 - "Mode may be null"). Temperature is marked readOnly here:
// it is a sensor, not an actuator, and was never meant to go through the
// Dual Devices Model - the EdgeX device profile itself stays "RW" (see
// apps/device-service's profile) purely so the Dev Simulator's new
// .../simulate endpoint can still push a new reading through core-command.
const DEVICE_NAME = "example-virtual-sensor-01";

const CAPABILITIES = {
  resources: [
    { name: "Switch" },
    { name: "Temperature", readOnly: true },
    { name: "Heater" },
    { name: "Cooler" },
  ],
  forbidden: [
    {
      when: { resource: "Heater", equals: true },
      conflictsWith: { resource: "Cooler", equals: true },
    },
  ],
};

const PREVIOUS_CAPABILITIES = {
  resources: ["Switch", "Temperature", "Heater", "Cooler"],
  forbidden: [
    {
      when: { resource: "Heater", equals: true },
      conflictsWith: { resource: "Cooler", equals: true },
    },
  ],
};

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(
    `UPDATE devices SET capabilities = '${JSON.stringify(CAPABILITIES)}'::jsonb, updated_at = now() WHERE name = '${DEVICE_NAME}'`,
  );
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(
    `UPDATE devices SET capabilities = '${JSON.stringify(PREVIOUS_CAPABILITIES)}'::jsonb, updated_at = now() WHERE name = '${DEVICE_NAME}'`,
  );
};
