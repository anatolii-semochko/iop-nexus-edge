import type { MigrationBuilder } from "node-pg-migrate";

// Model State Validator forbidden-rules move here from devices.capabilities
// (AGENTS_TO_DO.md's 2026-07-27 Device/Node refactor, Proposal A) - now that a
// Device is atomic (one value, no bundled resources), a rule like "Heater
// and Cooler must never both be active" is a property of the physical
// assembly they're both mounted on (the Node), not of either Device in
// isolation. Same shape as the old devices.capabilities.forbidden, just
// `device` (a name, resolved within this node's own devices) instead of
// `resource`: [{when: {device, equals}, conflictsWith: {device, equals}}].
export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumn("nodes", {
    forbidden: { type: "jsonb", notNull: true, default: pgm.func("'[]'::jsonb") },
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropColumn("nodes", "forbidden");
};
