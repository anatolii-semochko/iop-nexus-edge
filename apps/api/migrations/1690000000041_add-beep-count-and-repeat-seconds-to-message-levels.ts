import type { MigrationBuilder } from "node-pg-migrate";

// Message Levels redesign (AGENTS_TO_DO.md, 2026-08-01): a level's beep
// pattern now also carries how many beeps play per burst (`beep_count`,
// 1-4, only meaningful for shortBeep/longBeep - null for off/constant,
// same "not applicable" convention as heartbeat/data-logger thresholds
// already use for their own nullable fields).
//
// `period_deciseconds` (integer tenths of a second, "repeat forever at
// this period") becomes `repeat_seconds` (numeric seconds, 0.00 UI
// format) with a changed meaning at zero: 0 now means "play the burst
// once when the alarm triggers, then stay silent until it clears and
// re-triggers" (edge-triggered), not "repeat with no gap" - confirmed
// with the user. Existing data only ever seeded to 0 (mode 'off' on every
// row, migration 1690000000018), so the `using` conversion below (divide
// by 10) has no real values to worry about losing precision on.
export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumn("message_levels", {
    beep_count: {
      type: "integer",
      notNull: false,
      check: "beep_count IS NULL OR beep_count BETWEEN 1 AND 4",
    },
  });

  pgm.renameColumn("message_levels", "period_deciseconds", "repeat_seconds");
  pgm.alterColumn("message_levels", "repeat_seconds", {
    type: "numeric(6,2)",
    using: "repeat_seconds::numeric(6,2) / 10",
    default: 0,
    notNull: true,
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.alterColumn("message_levels", "repeat_seconds", {
    type: "integer",
    using: "ROUND(repeat_seconds * 10)::integer",
    default: 0,
    notNull: true,
  });
  pgm.renameColumn("message_levels", "repeat_seconds", "period_deciseconds");

  pgm.dropColumn("message_levels", "beep_count");
};
