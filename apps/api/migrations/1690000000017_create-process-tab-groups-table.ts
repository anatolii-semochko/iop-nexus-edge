import type { MigrationBuilder } from "node-pg-migrate";

// Many-to-many: which Tab Groups a process is curated into (AGENTS.md
// section 22) - drives that group's dynamic tab on the Processes page.
// Both sides cascade - deleting a process or a tab group should never
// leave orphaned membership rows behind, and there's no business rule
// (unlike process_groups) requiring a group to be empty before deletion.
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable("process_tab_groups", {
    process_id: {
      type: "integer",
      notNull: true,
      references: '"processes"',
      onDelete: "CASCADE",
    },
    tab_group_id: {
      type: "integer",
      notNull: true,
      references: '"tab_groups"',
      onDelete: "CASCADE",
    },
  });

  pgm.addConstraint("process_tab_groups", "process_tab_groups_pkey", {
    primaryKey: ["process_id", "tab_group_id"],
  });
  // The PK's own index only serves lookups led by process_id - the reverse
  // direction ("which processes are in this tab group", what every dynamic
  // tab needs) needs its own index.
  pgm.createIndex("process_tab_groups", "tab_group_id");
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable("process_tab_groups");
};
