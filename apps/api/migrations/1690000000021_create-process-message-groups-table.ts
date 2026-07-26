import type { MigrationBuilder } from "node-pg-migrate";

// Many-to-many: which Message Groups a process sends its WEM into
// (AGENTS.md section 22) - notification routing, independent of Tab
// Groups (process_tab_groups) even though the shape is identical. Both
// sides cascade, same reasoning as process_tab_groups.
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable("process_message_groups", {
    process_id: {
      type: "integer",
      notNull: true,
      references: '"processes"',
      onDelete: "CASCADE",
    },
    message_group_id: {
      type: "integer",
      notNull: true,
      references: '"message_groups"',
      onDelete: "CASCADE",
    },
  });

  pgm.addConstraint("process_message_groups", "process_message_groups_pkey", {
    primaryKey: ["process_id", "message_group_id"],
  });
  pgm.createIndex("process_message_groups", "message_group_id");
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable("process_message_groups");
};
