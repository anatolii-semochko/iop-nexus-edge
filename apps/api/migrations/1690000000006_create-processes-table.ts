import type { MigrationBuilder } from "node-pg-migrate";

// Process Registry (AGENTS.md section 10 - first orchestration step): the
// design-time definition of a process, same split as nodes/devices - this
// table is the source of truth for what a process *is* (name, group, type,
// which actions apply, which device it drives, its config), while live
// runtime state (on/off, critical) lives in Redis (apps/api/src/
// processRegistry.ts), mirroring the Device Registry / Dual Devices Model
// split already used for devices.
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable("processes", {
    id: "id",
    name: { type: "text", notNull: true },
    group_name: { type: "text", notNull: true },
    // "controllable" processes can be started/stopped (actions apply);
    // "permanent" ones cannot (no actions - AGENTS.md's "critical
    // processes that must run continuously").
    type: {
      type: "text",
      notNull: true,
      check: "type in ('controllable', 'permanent')",
    },
    // Discriminates which control-loop logic apps/orchestrator runs for
    // this process - not a generic plugin system yet (that's future work),
    // just a fixed set of known process kinds.
    kind: { type: "text", notNull: true },
    // Which of START/PAUSE/STOP/ON/OFF apply to this process, shown as
    // buttons in the UI - empty for "permanent" processes.
    actions: { type: "text[]", notNull: true, default: pgm.func("'{}'::text[]") },
    device_id: {
      type: "integer",
      references: '"devices"',
      onDelete: "SET NULL",
    },
    // Process-specific config (e.g. {min, max, linkedProcessIds}) - shape
    // depends on `kind`, same "loose jsonb, interpreted by the consumer"
    // approach as devices.capabilities.
    config: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createIndex("processes", "device_id");
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable("processes");
};
