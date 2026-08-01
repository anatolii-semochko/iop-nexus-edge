import type { MigrationBuilder } from "node-pg-migrate";

// Node Groups and Device Groups (AGENTS_TO_DO.md, 2026-08-01) - logical/
// business groupings, distinct from the existing Process/Tab/Message
// Groups (AGENTS.md section 23). Two different relationship shapes,
// mirroring that section's "three group entities, not one" finding:
//
// - Node Groups: single-FK, like Process Groups. A Node models one
//   physical workplace served by a group of Nodes - "a Node is in
//   exactly one group" (or none yet). `nodes.group_id` is nullable
//   (unlike processes.group_id) since existing Nodes predate this
//   feature and have nothing to backfill from - RESTRICT still applies
//   once a group has members, routes/nodeGroups.ts pre-checks emptiness.
// - Device Groups: many-to-many, like Tab/Message Groups. A Device
//   models a logical workplace and can appear in several groups at once
//   (shared devices - e.g. a siren in both a "fire" and "intrusion"
//   group). Freely deletable via CASCADE, no emptiness rule.
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable("node_groups", {
    id: "id",
    name: { type: "text", notNull: true, unique: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addColumn("nodes", {
    group_id: {
      type: "integer",
      references: '"node_groups"',
      onDelete: "RESTRICT",
    },
  });

  pgm.createTable("device_groups", {
    id: "id",
    name: { type: "text", notNull: true, unique: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("device_device_groups", {
    device_id: {
      type: "integer",
      notNull: true,
      references: '"devices"',
      onDelete: "CASCADE",
    },
    device_group_id: {
      type: "integer",
      notNull: true,
      references: '"device_groups"',
      onDelete: "CASCADE",
    },
  });

  pgm.addConstraint("device_device_groups", "device_device_groups_pkey", {
    primaryKey: ["device_id", "device_group_id"],
  });
  pgm.createIndex("device_device_groups", "device_group_id");
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable("device_device_groups");
  pgm.dropTable("device_groups");
  pgm.dropColumn("nodes", "group_id");
  pgm.dropTable("node_groups");
};
