import type { MigrationBuilder } from "node-pg-migrate";

// Alarm Annunciator (AGENTS_TO_DO.md, 2026-08-02) - an operator panel
// node: 16 LED indicators (8 red/error, 8 yellow/warning, one pair per
// Message Group slot) plus its own buzzer. Seeds the node, all 17
// devices, and the driving process in one migration - direct reuse of
// `1690000000031_seed-example-thermal-node.ts`'s "array + loop" shape,
// scaled up.
//
// `heartbeat_control`/`data_logger_control` are set to the same rich
// defaults `1690000000025_add-heartbeat-control-to-entities.ts`/
// `1690000000036_add-data-logger.ts` backfilled onto every
// already-existing row at the time - the column-level default is just
// `{}`, which several UI/API paths assume is never actually what a row
// carries (they read `.warning.level` etc. unconditionally).
const NODE_NAME = "alarm-annunciator-01";

const HEARTBEAT_CONTROL_DEFAULT = JSON.stringify({
  stoppable: false,
  warning: { numberSkippedTicks: 3, level: 1 },
  error: { numberSkippedTicks: 10, level: 1 },
});
const DATA_LOGGER_CONTROL_DEFAULT = JSON.stringify({
  writeEnabled: false,
  periodSeconds: null,
  warning: { numberSkippedPeriods: 1, level: 1 },
  error: { numberSkippedPeriods: 2, level: 1 },
});

interface DeviceSeed {
  type: string;
  name: string;
  capabilities: Record<string, unknown>;
}

const LED_DEVICES: DeviceSeed[] = [
  ...Array.from({ length: 8 }, (_, i) => ({
    type: "led",
    name: `annunciator-error-${i + 1}`,
    capabilities: { edgexResource: "Led" },
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    type: "led",
    name: `annunciator-warning-${i + 1}`,
    capabilities: { edgexResource: "Led" },
  })),
];
const BUZZER_DEVICE: DeviceSeed = {
  type: "active-buzzer",
  name: "annunciator-buzzer-01",
  capabilities: { edgexResource: "Buzzer" },
};
const DEVICES: DeviceSeed[] = [...LED_DEVICES, BUZZER_DEVICE];

// 8 slots, one per Message Group - `messageGroupId` starts unbound
// (null) until an admin assigns it via the process's own settings
// (generic `PATCH /processes/:id/config`, same route every other
// process kind's config already uses). Device ids are looked up by
// name via subselects - deterministic, since this migration mints
// them a few statements above.
function slotsJsonExpression(): string {
  const slots = Array.from({ length: 8 }, (_, i) => {
    const n = i + 1;
    return `jsonb_build_object(
      'redDeviceId', (SELECT id FROM devices WHERE name = 'annunciator-error-${n}'),
      'yellowDeviceId', (SELECT id FROM devices WHERE name = 'annunciator-warning-${n}'),
      'messageGroupId', NULL
    )`;
  });
  return `jsonb_build_array(${slots.join(", ")})`;
}

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`INSERT INTO process_groups (name) VALUES ('System') ON CONFLICT (name) DO NOTHING`);

  pgm.sql(`INSERT INTO nodes (type, name) VALUES ('alarm-annunciator', '${NODE_NAME}')`);

  for (const device of DEVICES) {
    pgm.sql(`
      INSERT INTO devices (type, name, node_id, backend, edgex_device_name, capabilities, heartbeat_control, data_logger_control)
      VALUES (
        '${device.type}',
        '${device.name}',
        (SELECT id FROM nodes WHERE name = '${NODE_NAME}'),
        'virtual',
        '${device.name}',
        '${JSON.stringify(device.capabilities)}'::jsonb,
        '${HEARTBEAT_CONTROL_DEFAULT}'::jsonb,
        '${DATA_LOGGER_CONTROL_DEFAULT}'::jsonb
      )
    `);
  }

  pgm.sql(`
    INSERT INTO processes (name, group_id, type, kind, actions, device_id, config)
    VALUES (
      'Alarm Annunciator',
      (SELECT id FROM process_groups WHERE name = 'System'),
      'controllable',
      'alarm-annunciator',
      ARRAY['ON', 'OFF'],
      (SELECT id FROM devices WHERE name = '${BUZZER_DEVICE.name}'),
      jsonb_build_object(
        'slots', ${slotsJsonExpression()},
        'testLevel', NULL,
        'testSlotIndex', NULL
      )
    )
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DELETE FROM processes WHERE kind = 'alarm-annunciator'`);
  pgm.sql(`DELETE FROM devices WHERE name IN (${DEVICES.map((d) => `'${d.name}'`).join(", ")})`);
  pgm.sql(`DELETE FROM nodes WHERE name = '${NODE_NAME}'`);
  pgm.sql(`
    DELETE FROM process_groups
    WHERE name = 'System' AND NOT EXISTS (SELECT 1 FROM processes WHERE group_id = process_groups.id)
  `);
};
