import type { MigrationBuilder } from "node-pg-migrate";

// Partial physical network (AGENTS_TO_DO.md, 2026-08-09/10 discussion) -
// lets a Node (or a standalone Device, node_id IS NULL) be switched
// between its physical EdgeX identity and an opt-in simulated twin, live,
// without touching apps/device-service's own config-time-only physical/
// virtual `backend` flag (AGENTS.md section 6 - that one stays exactly as
// unsafe-to-hot-swap as documented; this is a different, additive axis).
//
// `simulated` is a pure redirect flag - which of a device's *two*
// registered EdgeX device names (`edgex_device_name` vs
// `edgex_device_name_simulated`) apps/api's readValue/writeValue calls
// resolve to. Deliberately NOT tied to the existing `backend` column
// (physical/virtual) - a device can have two EdgeX registrations of any
// backend combination; `backend` still describes this device's *primary*
// registration exactly as it always has.
//
// Node is the primary switching granularity for node-attached devices
// (confirmed with the user: "Свічер... для нод і пристроїв-сиріт" - a
// device that belongs to a node switches with its whole node, not
// individually) - `nodes.simulated` is the single source of truth there;
// `devices.simulated` only has independent meaning for a standalone
// device (`node_id IS NULL`). Resolution logic (apps/api's new
// resolveEdgexDeviceName) reads whichever one actually applies.
//
// `edgex_device_name_simulated` nullable = opt-in with no separate flag
// needed: a device with no simulated twin provisioned simply can't be
// toggled (the PATCH route rejects, the UI switch is disabled) - the
// column being set at all *is* "this device supports simulated mode".
export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumn("nodes", {
    simulated: { type: "boolean", notNull: true, default: false },
  });
  pgm.addColumn("devices", {
    simulated: { type: "boolean", notNull: true, default: false },
    edgex_device_name_simulated: { type: "text" },
  });

  // log_command's own action CHECK constraint (migration ...039) needs
  // the two new command-log actions this feature's PATCH routes emit.
  pgm.dropConstraint("log_command", "log_command_action_check");
  pgm.addConstraint(
    "log_command",
    "log_command_action_check",
    "CHECK (action in ('write', 'auto', 'release', 'simulate', 'on', 'off', 'config', 'simulated-on', 'simulated-off'))",
  );
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropConstraint("log_command", "log_command_action_check");
  pgm.addConstraint(
    "log_command",
    "log_command_action_check",
    "CHECK (action in ('write', 'auto', 'release', 'simulate', 'on', 'off', 'config'))",
  );

  pgm.dropColumn("devices", ["simulated", "edgex_device_name_simulated"]);
  pgm.dropColumn("nodes", "simulated");
};
