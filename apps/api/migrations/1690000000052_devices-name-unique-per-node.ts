import type { MigrationBuilder } from "node-pg-migrate";

// Device `name` was globally unique across the whole fleet - inconvenient
// once multiple instances of the same node type exist (e.g. a second
// control-node re-seeding its own "...-led-green"-style names -
// AGENTS_TO_DO.md, 2026-08-23). `name` only ever needs to disambiguate
// devices a user could actually confuse in the UI - siblings on the same
// node - not the whole fleet. `edgex_device_name`'s own separate UNIQUE
// constraint (untouched here) is what actually has to stay globally
// unique, since that's the one EdgeX itself requires.
//
// Two partial unique indexes, not one plain composite UNIQUE(node_id,
// name): Postgres treats every NULL node_id as distinct from every other
// in a composite UNIQUE, so a plain composite constraint would leave
// standalone devices (node_id IS NULL) completely unconstrained by name
// instead of merely node-scoped. Confirmed with the user: standalone
// devices have no node to disambiguate them in the UI, so they keep
// their previous global-uniqueness behavior via their own index.
export const up = (pgm: MigrationBuilder): void => {
  pgm.dropConstraint("devices", "devices_name_key");
  pgm.createIndex("devices", ["node_id", "name"], {
    name: "devices_name_unique_per_node",
    unique: true,
    where: "node_id IS NOT NULL",
  });
  pgm.createIndex("devices", "name", {
    name: "devices_name_unique_standalone",
    unique: true,
    where: "node_id IS NULL",
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropIndex("devices", "name", { name: "devices_name_unique_standalone" });
  pgm.dropIndex("devices", ["node_id", "name"], { name: "devices_name_unique_per_node" });
  pgm.addConstraint("devices", "devices_name_key", { unique: "name" });
};
