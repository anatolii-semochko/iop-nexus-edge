import type { MigrationBuilder } from "node-pg-migrate";

// Simulation processes (AGENTS_TO_DO.md, 2026-08-29) - a third
// `processes.type` alongside the existing `controllable`/`permanent`,
// for a process kind whose only job is to generate a fake reading for a
// readOnly Device over time (the same "process computes a value, writes
// it" shape `weather-control`'s own `light-level` already established,
// just targeting `/simulate` instead of `/reading` - see that route's
// own doc comment for why those two write paths differ).
//
// Deliberately NOT a new table, and NO new columns on `processes` -
// checked the existing schema first: `device_id`/`node_id` (both
// already nullable FKs) cover the "which Device/Node does this
// simulate" link, `config` jsonb already covers "several Devices, one
// process" (same pattern `aquarium-light-control`'s own `mainChannels`
// array uses) for cases like 8 identical lighting channels not
// warranting 8 identical processes, and the existing `status`
// ("on"/"off", processRegistry.ts, Redis-backed - already real, already
// used by Active Buzzer/Alarm Annunciator) already means exactly
// "sleeps until turned on". Only the CHECK constraint needed widening.
export const up = (pgm: MigrationBuilder): void => {
  pgm.dropConstraint("processes", "processes_type_check");
  pgm.addConstraint("processes", "processes_type_check", {
    check: "type in ('controllable', 'permanent', 'simulation')",
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropConstraint("processes", "processes_type_check");
  pgm.addConstraint("processes", "processes_type_check", {
    check: "type in ('controllable', 'permanent')",
  });
};
