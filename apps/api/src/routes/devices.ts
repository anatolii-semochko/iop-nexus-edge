import type { FastifyBaseLogger, FastifyInstance } from "fastify";

import * as dualDevicesModel from "../dualDevicesModel.js";
import { pool } from "../db.js";
import { logCommand } from "../commandLog.js";
import { EdgeXError, listEdgeXDevices, readValue, writeValue, type EdgeXDeviceStatus } from "../edgex.js";
import { devicesNeededFor, validateWrite, type ForbiddenRule } from "../validator.js";

/**
 * A Device's declared capabilities (Postgres `devices.capabilities`) - flat,
 * not an array (to-do.txt's 2026-07-27 Device/Node refactor): a Device is
 * atomic, exactly one value, so there is nothing left to enumerate.
 * `edgexResource` is which EdgeX deviceResource/command this Device's value
 * is called under - an internal detail of talking to EdgeX, not something a
 * client ever addresses directly. `readOnly: true` marks a pure sensor - one
 * with no AUTO/MANUAL concept at all (see AGENTS.md section 6/7): such a
 * device never gets a `dualState`, and the normal MANUAL-override write path
 * (below) rejects it - the *EdgeX* device profile for a read-only sensor
 * still declares it `RW` (core-command itself would otherwise refuse to
 * accept writes at all), but Devices API is what actually polices "no
 * ordinary command surface for this device" - `/simulate` is the one
 * exception, dev-only.
 */
interface DeviceCapabilities {
  edgexResource?: string;
  readOnly?: boolean;
  min?: number;
  max?: number;
  step?: number;
}

interface DeviceRow {
  id: number;
  node_id: number | null;
  type: string;
  name: string;
  location: string | null;
  backend: "physical" | "virtual";
  edgex_device_name: string | null;
  capabilities: DeviceCapabilities;
  created_at: string;
  updated_at: string;
}

interface NodeRow {
  id: number;
  forbidden: ForbiddenRule[];
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  // List view: registry metadata plus EdgeX admin/operating state, fetched
  // once for every device.
  app.get("/devices", async () => {
    const result = await pool.query<DeviceRow>("SELECT * FROM devices ORDER BY name");

    let edgexByName = new Map<string, EdgeXDeviceStatus>();
    try {
      edgexByName = new Map((await listEdgeXDevices()).map((d) => [d.name, d]));
    } catch (err) {
      app.log.warn({ err }, "failed to fetch EdgeX device list; returning registry data without live status");
    }

    return result.rows.map((device) => ({
      ...device,
      edgex: device.edgex_device_name ? (edgexByName.get(device.edgex_device_name) ?? null) : null,
    }));
  });

  // Detail view: registry metadata, the device's live value (read straight
  // from EdgeX core-command), and its Dual Devices Model state (AUTO/
  // MANUAL, valueAuto/valueManual) - singular now, not one entry per
  // resource, since a Device is atomic.
  app.get<{ Params: { id: string } }>("/devices/:id", async (request, reply) => {
    const device = await findDevice(request.params.id);
    if (!device) {
      return reply.code(404).send({ error: "device not found" });
    }

    let value: unknown = null;
    // Alongside `value`, not folded into it - the UI still needs to know
    // *how* to render/edit this device's single value (a Bool checkbox vs
    // a numeric stepper) and its display unit, the same metadata the old
    // per-resource EdgeXReading always carried.
    let valueType: string | null = null;
    let units: string | null = null;
    let dualState: dualDevicesModel.DeviceState | null = null;
    if (device.edgex_device_name && device.capabilities.edgexResource) {
      const edgexDeviceName = device.edgex_device_name;
      const edgexResource = device.capabilities.edgexResource;
      try {
        const reading = await readValue(edgexDeviceName, edgexResource);
        value = reading.value;
        valueType = reading.valueType;
        units = reading.units ?? null;
      } catch (err) {
        app.log.warn({ err, device: device.name }, "failed to read device value");
      }
      // A pure sensor (readOnly) has no AUTO/MANUAL mode at all - no
      // dualState, rather than defaulting to a misleading "AUTO".
      if (!device.capabilities.readOnly) {
        try {
          dualState = await dualDevicesModel.getState(device.id);
        } catch (err) {
          app.log.warn({ err, device: device.name }, "failed to read Dual Devices Model state");
        }
      }
    }

    return { ...device, value, valueType, units, dualState };
  });

  // Write path (UI-driven): Model State Validator, then Dual Devices Model
  // setManualActive (a direct UI write *is* what puts a device into MANUAL -
  // see AGENTS.md section 6), then proxy to EdgeX core-command. Used today
  // by the dev simulator page to override a virtual device's sensor values.
  app.put<{ Params: { id: string }; Body: { value: unknown } }>("/devices/:id", async (request, reply) => {
    const { value } = request.body;
    if (value === undefined) {
      return reply.code(400).send({ error: "request body must include a 'value'" });
    }

    const device = await requireEdgeXDevice(request.params.id, reply);
    if (!device) return;

    if (device.capabilities.readOnly) {
      return reply
        .code(400)
        .send({ error: `device '${device.name}' is read-only - it has no AUTO/MANUAL mode`, hint: "use .../simulate for dev testing" });
    }

    // Logged as an attempt, not just a success (AGENTS.md section 22) -
    // a rejected command is often the more interesting thing to audit,
    // so this runs before the forbidden-state/EdgeX checks below, not
    // gated on them succeeding.
    await logCommand({ deviceId: device.id, action: "write", value, source: "api" });

    const forbidden = await checkForbidden(device, value, app.log);
    if (!forbidden.ok) {
      return reply.code(409).send({ error: "forbidden state", reason: forbidden.reason });
    }

    const state = await dualDevicesModel.setManualActive(device.id, value);
    if (!(await writeOrReject(reply, device.edgex_device_name, device.capabilities.edgexResource, value))) return;
    return { status: "ok", state };
  });

  // Dev-only path for readOnly (sensor) devices: writes straight through to
  // EdgeX, bypassing the Dual Devices Model entirely - a pure sensor has no
  // AUTO/MANUAL concept (see the DeviceCapabilities comment above), so this
  // exists purely to let the Dev Simulator inject a new simulated reading
  // for a virtual device, the same way a physical sensor would push a new
  // value on its own.
  app.put<{ Params: { id: string }; Body: { value: unknown } }>("/devices/:id/simulate", async (request, reply) => {
    const { value } = request.body;
    if (value === undefined) {
      return reply.code(400).send({ error: "request body must include a 'value'" });
    }

    const device = await requireEdgeXDevice(request.params.id, reply);
    if (!device) return;

    if (!device.capabilities.readOnly) {
      return reply
        .code(400)
        .send({ error: `device '${device.name}' is not read-only`, hint: "use PUT /devices/:id instead" });
    }

    await logCommand({ deviceId: device.id, action: "simulate", value, source: "api" });

    if (!(await writeOrReject(reply, device.edgex_device_name, device.capabilities.edgexResource, value))) return;
    // No Dual Devices Model state for a readOnly device, but the new
    // reading still needs to reach the state:* cache and nexus.events -
    // otherwise this device could never do what it exists to test
    // (AGENTS.md section 9): pushing a live value change onto the bus.
    await dualDevicesModel.publishReading(device.id, value, "api");
    return { status: "ok" };
  });

  // Orchestrator-driven equivalent of the write path above: records
  // valueAuto, but only reaches EdgeX if the device is currently in AUTO
  // mode (a manual override keeps winning until released). Called every
  // tick by apps/orchestrator/src/processes/temperatureControl.ts.
  app.put<{ Params: { id: string }; Body: { value: unknown } }>("/devices/:id/auto", async (request, reply) => {
    const { value } = request.body;
    if (value === undefined) {
      return reply.code(400).send({ error: "request body must include a 'value'" });
    }

    const device = await requireEdgeXDevice(request.params.id, reply);
    if (!device) return;

    if (device.capabilities.readOnly) {
      return reply.code(400).send({ error: `device '${device.name}' is read-only - it has no AUTO/MANUAL mode` });
    }

    await logCommand({ deviceId: device.id, action: "auto", value, source: "api" });

    const forbidden = await checkForbidden(device, value, app.log);
    if (!forbidden.ok) {
      return reply.code(409).send({ error: "forbidden state", reason: forbidden.reason });
    }

    const state = await dualDevicesModel.setActive(device.id, value);
    if (state.mode === "AUTO") {
      if (!(await writeOrReject(reply, device.edgex_device_name, device.capabilities.edgexResource, value))) return;
    }
    return { status: "ok", state };
  });

  // Releases a device from MANUAL back to AUTO - the orchestrator's last
  // computed value takes over immediately.
  app.post<{ Params: { id: string } }>("/devices/:id/release", async (request, reply) => {
    const device = await requireEdgeXDevice(request.params.id, reply);
    if (!device) return;

    if (device.capabilities.readOnly) {
      return reply.code(400).send({ error: `device '${device.name}' is read-only - it has no AUTO/MANUAL mode` });
    }

    await logCommand({ deviceId: device.id, action: "release", source: "api" });

    const state = await dualDevicesModel.release(device.id);
    if (state.valueAuto !== undefined) {
      const forbidden = await checkForbidden(device, state.valueAuto, app.log);
      if (!forbidden.ok) {
        return reply.code(409).send({ error: "forbidden state", reason: forbidden.reason });
      }
      if (!(await writeOrReject(reply, device.edgex_device_name, device.capabilities.edgexResource, state.valueAuto))) return;
    }
    return { status: "ok", state };
  });

  // System-wide aggregate of every controllable device's mode (AGENTS.md
  // section 6). The full device list comes from Postgres (the source of
  // truth for what devices exist) - a device untouched in Redis is
  // implicitly AUTO, not simply absent from the count.
  app.get("/system/mode", async () => {
    const result = await pool.query<Pick<DeviceRow, "id" | "capabilities">>("SELECT id, capabilities FROM devices");
    const deviceIds = result.rows.filter((device) => !device.capabilities.readOnly).map((device) => device.id);
    return { mode: await dualDevicesModel.systemMode(deviceIds) };
  });
}

async function findDevice(id: string): Promise<DeviceRow | undefined> {
  const result = await pool.query<DeviceRow>("SELECT * FROM devices WHERE id = $1", [id]);
  return result.rows[0];
}

async function findDeviceByNodeAndName(nodeId: number, name: string): Promise<DeviceRow | undefined> {
  const result = await pool.query<DeviceRow>("SELECT * FROM devices WHERE node_id = $1 AND name = $2", [nodeId, name]);
  return result.rows[0];
}

async function findNode(id: number): Promise<NodeRow | undefined> {
  const result = await pool.query<NodeRow>("SELECT id, forbidden FROM nodes WHERE id = $1", [id]);
  return result.rows[0];
}

/**
 * Writes to EdgeX, translating a rejection (e.g. 405 "this resource is
 * read-only") into the matching HTTP status instead of letting it fall
 * through to Fastify's default 500 handler - an EdgeX 4xx reflects a bad
 * request, not a Devices API failure. Returns false (having already sent
 * the reply) on rejection, true on success.
 */
async function writeOrReject(
  reply: { code: (statusCode: number) => { send: (payload: unknown) => void } },
  edgexDeviceName: string,
  edgexResource: string | undefined,
  value: unknown,
): Promise<boolean> {
  if (!edgexResource) {
    reply.code(409).send({ error: "device has no edgexResource configured" });
    return false;
  }
  try {
    await writeValue(edgexDeviceName, edgexResource, value);
    return true;
  } catch (err) {
    if (err instanceof EdgeXError) {
      const status = err.status >= 400 && err.status < 500 ? err.status : 502;
      reply.code(status).send({ error: "EdgeX rejected the write", reason: err.message });
      return false;
    }
    throw err;
  }
}

async function requireEdgeXDevice(
  id: string,
  reply: { code: (statusCode: number) => { send: (payload: unknown) => void } },
): Promise<(DeviceRow & { edgex_device_name: string }) | undefined> {
  const device = await findDevice(id);
  if (!device) {
    reply.code(404).send({ error: "device not found" });
    return undefined;
  }
  if (!device.edgex_device_name) {
    reply.code(409).send({ error: "device is not backed by EdgeX" });
    return undefined;
  }
  return device as DeviceRow & { edgex_device_name: string };
}

/**
 * Model State Validator, node-scoped (to-do.txt's 2026-07-27 Device/Node
 * refactor) - checks the written device's new value against its sibling
 * devices' *current* values on the same Node, per `nodes.forbidden`. A
 * device with no node has nothing to check against (a forbidden rule only
 * ever makes sense between devices sharing a physical assembly).
 */
async function checkForbidden(
  device: DeviceRow,
  value: unknown,
  log: FastifyBaseLogger,
): Promise<{ ok: true } | { ok: false; reason?: string }> {
  if (device.node_id === null) {
    return { ok: true };
  }

  const node = await findNode(device.node_id);
  const rules = node?.forbidden ?? [];
  if (rules.length === 0) {
    return { ok: true };
  }

  const nodeId = device.node_id;
  const currentValues: Record<string, unknown> = {};
  await Promise.all(
    devicesNeededFor(rules, device.name).map(async (name) => {
      const other = await findDeviceByNodeAndName(nodeId, name);
      if (!other || !other.edgex_device_name || !other.capabilities.edgexResource) {
        return;
      }
      const otherEdgexDeviceName = other.edgex_device_name;
      const otherEdgexResource = other.capabilities.edgexResource;
      currentValues[name] = await dualDevicesModel.resolveActiveValue(other.id, async () => {
        try {
          return (await readValue(otherEdgexDeviceName, otherEdgexResource)).value;
        } catch (err) {
          log.warn({ err, device: name }, "Model State Validator: failed to read current value");
          return undefined;
        }
      });
    }),
  );

  return validateWrite(rules, device.name, value, currentValues);
}
