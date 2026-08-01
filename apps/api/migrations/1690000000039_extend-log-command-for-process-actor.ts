import type { MigrationBuilder } from "node-pg-migrate";

// Logs page redesign (AGENTS_TO_DO.md, 2026-08-01) - `log_command` widens
// from "device commands only" to "every command, device- or process-
// targeted, from a human or the orchestrator": Commands tab now also
// covers a process's ON/OFF switch and config changes (previously
// unlogged entirely), and every row now says WHO issued it, not just
// a meaningless-in-practice `source` string (always literally "api").
//
// `process_id` mirrors `device_id`'s own nullable/ON DELETE SET NULL
// shape - a row targets exactly one of the two in practice (device
// actions vs process actions), but there's deliberately no CHECK
// enforcing "at least one" here: that would break the very reason
// `device_id` is nullable in the first place (a referenced device or
// process being deleted later must not retroactively invalidate an
// already-written log row - AGENTS.md section 22's original design for
// this table).
//
// `actor_type` distinguishes a human (UI, via `actor_user_id`) from the
// orchestrator (which has no user account and never will - it's not a
// login-capable actor, just an unauthenticated internal caller, AGENTS.md
// section 13). Backfilled from `action` for existing rows - `auto` was
// always orchestrator-only, the other three were always UI-only, so this
// is an exact backfill, not a guess.
export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumn("log_command", {
    process_id: {
      type: "integer",
      references: '"processes"',
      onDelete: "SET NULL",
    },
    actor_type: { type: "text" },
    actor_user_id: {
      type: "integer",
      references: '"users"',
      onDelete: "SET NULL",
    },
  });

  pgm.sql(`UPDATE log_command SET actor_type = CASE WHEN action = 'auto' THEN 'orchestrator' ELSE 'user' END`);

  pgm.alterColumn("log_command", "actor_type", { notNull: true });
  pgm.addConstraint("log_command", "log_command_actor_type_check", "CHECK (actor_type in ('user', 'orchestrator'))");

  pgm.dropConstraint("log_command", "log_command_action_check");
  pgm.addConstraint(
    "log_command",
    "log_command_action_check",
    "CHECK (action in ('write', 'auto', 'release', 'simulate', 'on', 'off', 'config'))",
  );

  pgm.createIndex("log_command", "process_id");
  pgm.createIndex("log_command", "actor_user_id");
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropIndex("log_command", "actor_user_id");
  pgm.dropIndex("log_command", "process_id");

  pgm.dropConstraint("log_command", "log_command_action_check");
  pgm.addConstraint(
    "log_command",
    "log_command_action_check",
    "CHECK (action in ('write', 'auto', 'release', 'simulate'))",
  );

  pgm.dropConstraint("log_command", "log_command_actor_type_check");

  pgm.dropColumn("log_command", "actor_user_id");
  pgm.dropColumn("log_command", "actor_type");
  pgm.dropColumn("log_command", "process_id");
};
