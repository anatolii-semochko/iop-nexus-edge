import type { MigrationBuilder } from "node-pg-migrate";

// Contextual reference (to-do.txt's 2026-07-27 Device/Node refactor,
// roadmap Phase 2.4) for a process whose devices span an entire Node
// (e.g. Temperature Control, which will drive several separate atomic
// Devices on the same node once Phase 4 lands) - for UI/grouping display
// only, not read by the orchestrator itself. The actual role -> deviceId
// mapping a multi-device process needs lives in `config` jsonb (Phase 4),
// same "loose jsonb, interpreted by the consumer" approach `config`
// already uses - `node_id` alone can't say *which* device on the node
// plays which role.
export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumn("processes", {
    node_id: {
      type: "integer",
      references: '"nodes"',
      onDelete: "SET NULL",
    },
  });
  pgm.createIndex("processes", "node_id");
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropColumn("processes", "node_id");
};
