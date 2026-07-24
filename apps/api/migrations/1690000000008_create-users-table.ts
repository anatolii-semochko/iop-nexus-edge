import type { MigrationBuilder } from "node-pg-migrate";

// UI-only authorization (AGENTS.md section 13) - login access to the admin
// panel, not per-endpoint API authorization (devices/nodes/processes stay
// open, deliberately, until that separate future task). `username` is
// always compared/stored lower-cased at the application layer (routes/
// users.ts) rather than relying on a citext extension - one less extension
// dependency for a single-column case-insensitivity need. `roles` is a
// Postgres array (not a comma-joined string) so a user can hold more than
// one role even though only 'admin' is meaningful today.
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable("users", {
    id: "id",
    username: { type: "text", notNull: true, unique: true },
    password_hash: { type: "text", notNull: true },
    display_name: { type: "text" },
    roles: { type: "text[]", notNull: true, default: pgm.func("'{}'::text[]") },
    avatar_path: { type: "text" },
    active: { type: "boolean", notNull: true, default: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable("users");
};
