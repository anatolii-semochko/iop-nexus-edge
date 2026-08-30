import type { MigrationBuilder } from "node-pg-migrate";

// log_command's own action CHECK constraint (migration ...039, widened by
// ...048/...050) needs the two Service->Database actions routes/
// serviceDatabase.ts's new apply/upload/clear-logs routes emit
// (AGENTS_TO_DO.md, 2026-08-30: "Команди SetState, ClearLogs логаються в
// LogsCommands"). Found live: commandLog.ts's own TS union widening alone
// isn't enough - this CHECK constraint is a separate, actual DB-level
// gate that silently swallowed every set-state/clear-logs insert
// (logCommand() is deliberately best-effort, so the failure never
// surfaced as an error, just a missing row).
export const up = (pgm: MigrationBuilder): void => {
  pgm.dropConstraint("log_command", "log_command_action_check");
  pgm.addConstraint(
    "log_command",
    "log_command_action_check",
    "CHECK (action in ('write', 'auto', 'release', 'simulate', 'on', 'off', 'config', 'simulated-on', 'simulated-off', 'create', 'delete', 'set-state', 'clear-logs'))",
  );
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropConstraint("log_command", "log_command_action_check");
  pgm.addConstraint(
    "log_command",
    "log_command_action_check",
    "CHECK (action in ('write', 'auto', 'release', 'simulate', 'on', 'off', 'config', 'simulated-on', 'simulated-off', 'create', 'delete'))",
  );
};
