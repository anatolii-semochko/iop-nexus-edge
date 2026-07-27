import type { MigrationBuilder } from "node-pg-migrate";

// Replaces the smoke-test example-virtual-sensor-01 (one Postgres devices
// row bundling four unrelated atomic devices - a sensor and three relays -
// as "resources") with the corrected model (to-do.txt's 2026-07-27
// Device/Node refactor): one Node row + four separate atomic Device rows,
// matching the four separate EdgeX devices migration ...Phase 1 already
// registered (apps/device-service/res/devices/example-devices.yaml).
//
// `forbidden` on the node (migration ...028, Proposal A) replaces the old
// devices.capabilities.forbidden rule (migration ...003/004) - same
// Heater/Cooler interlock, now expressed as a cross-device rule scoped to
// this node rather than a cross-resource rule scoped to one device.
const NODE_NAME = "example-thermal-node-01";
const NODE_FORBIDDEN = [
  {
    when: { device: "example-heater-01", equals: true },
    conflictsWith: { device: "example-cooler-01", equals: true },
  },
];

const DEVICES = [
  {
    type: "example-temperature",
    name: "example-temperature-01",
    capabilities: { edgexResource: "Temperature", readOnly: true },
  },
  {
    type: "example-heater",
    name: "example-heater-01",
    capabilities: { edgexResource: "Heater" },
  },
  {
    type: "example-cooler",
    name: "example-cooler-01",
    capabilities: { edgexResource: "Cooler" },
  },
  {
    type: "example-switch",
    name: "example-switch-01",
    capabilities: { edgexResource: "Switch" },
  },
];

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    INSERT INTO nodes (type, name, forbidden)
    VALUES ('example-thermal-node', '${NODE_NAME}', '${JSON.stringify(NODE_FORBIDDEN)}'::jsonb)
  `);

  for (const device of DEVICES) {
    pgm.sql(`
      INSERT INTO devices (type, name, node_id, backend, edgex_device_name, capabilities)
      VALUES (
        '${device.type}',
        '${device.name}',
        (SELECT id FROM nodes WHERE name = '${NODE_NAME}'),
        'virtual',
        '${device.name}',
        '${JSON.stringify(device.capabilities)}'::jsonb
      )
    `);
  }

  // Context only (migration ...029) - the orchestrator itself still reads
  // role->deviceId mapping from `config`, not wired until Phase 4.
  pgm.sql(`
    UPDATE processes
    SET node_id = (SELECT id FROM nodes WHERE name = '${NODE_NAME}')
    WHERE kind IN ('temperature-control', 'temperature-monitor')
  `);

  // ON DELETE SET NULL on processes.device_id and every log table's
  // device_id (already the case for deleted devices generally) means this
  // is safe - Temperature Control/Safety Monitor's device_id goes NULL
  // automatically, historical log rows keep their old device_id as NULL,
  // nothing else references this row.
  pgm.sql(`DELETE FROM devices WHERE name = 'example-virtual-sensor-01'`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    INSERT INTO devices (type, name, backend, edgex_device_name, capabilities)
    VALUES (
      'NexusEdge-Example-Virtual',
      'example-virtual-sensor-01',
      'virtual',
      'example-virtual-sensor-01',
      '{"resources": [{"name": "Switch"}, {"name": "Temperature", "readOnly": true}, {"name": "Heater"}, {"name": "Cooler"}], "forbidden": [{"when": {"resource": "Heater", "equals": true}, "conflictsWith": {"resource": "Cooler", "equals": true}}]}'::jsonb
    )
  `);

  pgm.sql(`
    UPDATE processes
    SET device_id = (SELECT id FROM devices WHERE name = 'example-virtual-sensor-01'), node_id = NULL
    WHERE kind IN ('temperature-control', 'temperature-monitor')
  `);

  pgm.sql(`DELETE FROM devices WHERE name IN (${DEVICES.map((d) => `'${d.name}'`).join(", ")})`);
  pgm.sql(`DELETE FROM nodes WHERE name = '${NODE_NAME}'`);
};
