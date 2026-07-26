import type { MigrationBuilder } from "node-pg-migrate";

// Tab Groups (AGENTS.md section 22) - an operator's own curated workspace:
// whichever processes one operator wants to watch, regardless of which
// Process Group (process_groups - the *technical* system, e.g. heating vs
// aquarium) those processes actually belong to. Deliberately distinct from
// both process_groups (technical grouping) and message_groups (WEM
// notification routing, unrelated concept - see that table's own comment).
// Each Tab Group becomes one dynamic tab on the Processes page, in
// admin-controlled `position` order - unlike process_groups (alphabetical
// only), order here is a real UX concern since it's literally tab order.
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable("tab_groups", {
    id: "id",
    name: { type: "text", notNull: true, unique: true },
    position: { type: "integer", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable("tab_groups");
};
