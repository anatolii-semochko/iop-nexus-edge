import type { MigrationBuilder } from "node-pg-migrate";

// Message Levels redesign (AGENTS_TO_DO.md, 2026-08-01) - the beep-pattern
// timing constants that used to be hardcoded in
// apps/orchestrator/src/processes/activeBuzzer.ts
// (SHORT_BEEP_ON_DECISECONDS / LONG_BEEP_ON_DECISECONDS) become admin-
// editable here instead, per the platform's own "never hardcode config
// values" rule. A one-row singleton table (`id` pinned to 1 via CHECK),
// same fixed-cardinality idea as `message_levels` itself but with exactly
// one row instead of eight - there is one buzzer-pattern timing profile
// for the whole system, not one per level (confirmed with the user).
//
// Defaults preserve the previous hardcoded on-durations exactly (2/8
// deciseconds -> 0.20s/0.80s), so nothing that was already audibly
// configured (mode shortBeep/longBeep on some level) changes sound the
// moment this migration runs - only the new per-beep pause values
// (previously nonexistent - a beep just repeated at its own period) are
// genuinely new numbers, picked as sensible-sounding defaults.
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable("message_signal_timing", {
    id: { type: "integer", notNull: true, check: "id = 1" },
    short_beep_seconds: { type: "numeric(6,2)", notNull: true, default: 0.2 },
    short_beep_pause_seconds: { type: "numeric(6,2)", notNull: true, default: 0.2 },
    long_beep_seconds: { type: "numeric(6,2)", notNull: true, default: 0.8 },
    long_beep_pause_seconds: { type: "numeric(6,2)", notNull: true, default: 0.4 },
  });

  pgm.addConstraint("message_signal_timing", "message_signal_timing_pkey", {
    primaryKey: ["id"],
  });

  pgm.sql(`INSERT INTO message_signal_timing (id) VALUES (1)`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable("message_signal_timing");
};
