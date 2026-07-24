import type { MigrationBuilder } from "node-pg-migrate";

export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable("nodes", {
    id: "id",
    type: { type: "text", notNull: true },
    name: { type: "text", notNull: true, unique: true },
    location: { type: "text" },
    bus_type: { type: "text" },
    bus_config: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    health: { type: "text", notNull: true, default: "unknown" },
    last_heartbeat_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable("nodes");
};
