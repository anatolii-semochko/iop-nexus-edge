import type { MigrationBuilder } from "node-pg-migrate";

// Extends the smoke-test example device (see migration ...002) with two
// actuator resources (Heater/Cooler) and a Model State Validator rule
// forbidding both being active at once - the exact example already used in
// AGENTS.md section 6, now made real and testable. Remove alongside the
// rest of the example device once real device types exist (AGENTS.md
// section 7).
const DEVICE_NAME = "example-virtual-sensor-01";

const CAPABILITIES = {
  resources: ["Switch", "Temperature", "Heater", "Cooler"],
  forbidden: [
    {
      when: { resource: "Heater", equals: true },
      conflictsWith: { resource: "Cooler", equals: true },
    },
  ],
};

const PREVIOUS_CAPABILITIES = {
  resources: ["Switch", "Temperature"],
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
