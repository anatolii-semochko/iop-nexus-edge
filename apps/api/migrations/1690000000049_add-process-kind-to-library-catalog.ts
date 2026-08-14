import type { MigrationBuilder } from "node-pg-migrate";

// Process Library Catalog (AGENTS_TO_DO.md, 2026-08-14 process management
// discussion) - a third kind alongside the existing "device"/"node" on the
// same library_categories/library_items tables, rather than a parallel set
// of tables. The user's own framing: "каталог має бути в Library" - process
// *kinds* are a design-time catalog exactly like device/node types, just
// sourced from devices/processes/ instead of devices/standalone/ or
// devices/nodes/ (see libraryCatalog.ts's own updated walk). No schema
// shape actually needs to differ - a process kind's library.json is the
// same {id, name, description} the other two kinds already use.
export const up = (pgm: MigrationBuilder): void => {
  pgm.dropConstraint("library_categories", "library_categories_kind_check");
  pgm.addConstraint("library_categories", "library_categories_kind_check", {
    check: "kind in ('device', 'node', 'process')",
  });
  pgm.dropConstraint("library_items", "library_items_kind_check");
  pgm.addConstraint("library_items", "library_items_kind_check", {
    check: "kind in ('device', 'node', 'process')",
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropConstraint("library_items", "library_items_kind_check");
  pgm.addConstraint("library_items", "library_items_kind_check", {
    check: "kind in ('device', 'node')",
  });
  pgm.dropConstraint("library_categories", "library_categories_kind_check");
  pgm.addConstraint("library_categories", "library_categories_kind_check", {
    check: "kind in ('device', 'node')",
  });
};
