import type { MigrationBuilder } from "node-pg-migrate";

// Real bug found live while verifying Nodes' new expand-row detail
// (AGENTS_TO_DO.md, 2026-08-02): `nodes.heartbeat_control` has been
// stuck at its bare `{}` column default since migration
// 1690000000025_add-heartbeat-control-to-entities.ts added the column -
// that migration's own backfill only covered `processes`/`devices` ("No
// nodes exist yet... nothing to backfill", true at the time). Nodes
// created since (`example-thermal-node-01`, migration 031;
// `alarm-annunciator-01`, migration 043) inherited the bare default -
// `GET /heartbeat-controls` already lists node-type entries alongside
// devices/processes, and `HeartbeatEditModal.jsx` reads `.warning.level`
// unconditionally, crashing on any node whose `heartbeat_control` is
// missing the key entirely (same bug class as the device-side gap found
// while seeding house-buzzer-01 in nexus-edge-smart-house). Same rich
// shape as migration 025's own backfill.
export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    UPDATE nodes
    SET heartbeat_control = '{"stoppable": false, "warning": {"numberSkippedTicks": 3, "level": 1}, "error": {"numberSkippedTicks": 10, "level": 1}}'::jsonb
    WHERE heartbeat_control = '{}'::jsonb
  `);
};

// Deliberately no-op - a backfill of already-drifted rows, not something
// meaningful to reverse (matches migration 025's own down() reasoning:
// dropping the column, not un-backfilling specific rows, is the actual
// inverse, and that's owned by 025 itself, not this follow-up).
export const down = (): void => {};
