import type { MigrationBuilder } from "node-pg-migrate";

// Message Groups (AGENTS.md section 22's original "which message groups
// does this process send to" concept) - notification routing, deliberately
// NOT the same thing as Tab Groups (tab_groups - an operator's curated
// workspace of processes, drives page tabs) or process_groups (the
// technical system a process belongs to). Not tied to either: an operator
// doesn't necessarily watch one whole Process Group, so which WEM messages
// they care about is its own independent grouping. No `position` - unlike
// Tab Groups, nothing here drives a tab or any other ordered UI, so plain
// alphabetical (matching process_groups' own convention) is enough.
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable("message_groups", {
    id: "id",
    name: { type: "text", notNull: true, unique: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable("message_groups");
};
