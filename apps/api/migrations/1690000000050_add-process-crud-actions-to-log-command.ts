import type { MigrationBuilder } from "node-pg-migrate";

// log_command's own action CHECK constraint (migration ...039, widened by
// ...048) needs the two new command-log actions routes/processes.ts's new
// POST/DELETE /processes emit (AGENTS_TO_DO.md, 2026-08-14 process
// management).
export const up = (pgm: MigrationBuilder): void => {
  pgm.dropConstraint("log_command", "log_command_action_check");
  pgm.addConstraint(
    "log_command",
    "log_command_action_check",
    "CHECK (action in ('write', 'auto', 'release', 'simulate', 'on', 'off', 'config', 'simulated-on', 'simulated-off', 'create', 'delete'))",
  );
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropConstraint("log_command", "log_command_action_check");
  pgm.addConstraint(
    "log_command",
    "log_command_action_check",
    "CHECK (action in ('write', 'auto', 'release', 'simulate', 'on', 'off', 'config', 'simulated-on', 'simulated-off'))",
  );
};
