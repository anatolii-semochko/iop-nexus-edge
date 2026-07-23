import type { MigrationBuilder } from "node-pg-migrate";

export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable("devices", {
    id: "id",
    node_id: {
      type: "integer",
      references: '"nodes"',
      onDelete: "SET NULL",
    },
    type: { type: "text", notNull: true },
    name: { type: "text", notNull: true, unique: true },
    location: { type: "text" },
    backend: {
      type: "text",
      notNull: true,
      check: "backend in ('physical', 'virtual')",
    },
    edgex_device_name: { type: "text", unique: true },
    capabilities: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createIndex("devices", "node_id");
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable("devices");
};
