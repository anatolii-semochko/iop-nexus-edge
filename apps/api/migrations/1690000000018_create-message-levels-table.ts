import type { MigrationBuilder } from "node-pg-migrate";

// Message Levels (AGENTS.md section 22's "warning/error 1-4 level -> period
// scale", finally built) - a FIXED 8-row matrix (type x level), not an
// admin-addable/removable list like process_groups/message_groups: the two
// types and four severity levels are inherent to the WEM model already
// established (processMessages.ts's own TYPE_RANK), not something an admin
// should be able to add a 9th row to. Only `mode`/`period_deciseconds` are
// ever edited (routes/messageLevels.ts's PATCH).
//
// This phase only stores the config - no live audio-beeping is wired up
// yet (deliberately deferred, same as the still-unbuilt `messenger` process
// kind noted in section 22 - this table is what a future beeper/messenger
// would read from, not something that does anything on its own today).
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable("message_levels", {
    type: { type: "text", notNull: true, check: "type in ('warning', 'error')" },
    level: { type: "integer", notNull: true, check: "level between 1 and 4" },
    mode: {
      type: "text",
      notNull: true,
      default: "off",
      check: "mode in ('off', 'constant', 'shortBeep', 'longBeep')",
    },
    period_deciseconds: { type: "integer", notNull: true, default: 0 },
  });

  pgm.addConstraint("message_levels", "message_levels_pkey", {
    primaryKey: ["type", "level"],
  });

  pgm.sql(`
    INSERT INTO message_levels (type, level)
    VALUES
      ('warning', 1), ('warning', 2), ('warning', 3), ('warning', 4),
      ('error', 1), ('error', 2), ('error', 3), ('error', 4)
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable("message_levels");
};
