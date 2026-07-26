import type { MigrationBuilder } from "node-pg-migrate";

// Groups become a real, manageable entity (AGENTS.md section 10/17 update).
// `processes.group_name` was free-text with no independent identity -
// "rename a group" meant find/replace across every process row, and a
// group with zero processes in it couldn't exist or be listed at all.
// `process_groups` is now the source of truth; `processes.group_id`
// references it. `ON DELETE RESTRICT` is the DB-level backstop for "can't
// delete a non-empty group" - routes/processGroups.ts checks and returns a
// friendly 400 before ever hitting it, this is just defense in depth.
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable("process_groups", {
    id: "id",
    name: { type: "text", notNull: true, unique: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // Backfill one row per distinct existing group_name before the column
  // that produced them is dropped below.
  pgm.sql(`INSERT INTO process_groups (name) SELECT DISTINCT group_name FROM processes`);

  pgm.addColumn("processes", {
    group_id: {
      type: "integer",
      references: '"process_groups"',
      onDelete: "RESTRICT",
    },
  });

  pgm.sql(`
    UPDATE processes p
    SET group_id = g.id
    FROM process_groups g
    WHERE g.name = p.group_name
  `);

  pgm.alterColumn("processes", "group_id", { notNull: true });
  pgm.dropColumn("processes", "group_name");
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.addColumn("processes", { group_name: { type: "text" } });
  pgm.sql(`
    UPDATE processes p
    SET group_name = g.name
    FROM process_groups g
    WHERE g.id = p.group_id
  `);
  pgm.alterColumn("processes", "group_name", { notNull: true });
  pgm.dropColumn("processes", "group_id");
  pgm.dropTable("process_groups");
};
