import type { FastifyBaseLogger, FastifyInstance } from "fastify";

import * as dualDevicesModel from "../dualDevicesModel.js";
import { pool } from "../db.js";
import { logCommand } from "../deviceCommandLog.js";
import { EdgeXError, listEdgeXDevices, readResource, writeResource, type EdgeXDeviceStatus } from "../edgex.js";
import { resourcesNeededFor, validateWrite, type ForbiddenRule } from "../validator.js";

/**
 * A resource's declared shape (Postgres `devices.capabilities.resources`).
 * `readOnly: true` marks a pure sensor - one with no AUTO/MANUAL concept at
 * all (see AGENTS.md section 6/7): such a resource never gets a `dualState`
 * entry, and the normal MANUAL-override write path (below) rejects it - the
 * *EdgeX* device profile for a read-only sensor still declares it `RW`
 * (core-command itself would otherwise refuse to accept writes at all), but
 * Devices API is what actually polices "no ordinary command surface for
 * this resource" - `/simulate` is the one exception, dev-only.
 */
interface ResourceCapability {
  name: string;
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
  capabilities: { resources?: ResourceCapability[]; forbidden?: ForbiddenRule[] };
  created_at: string;
  updated_at: string;
}

function findResourceCapability(device: DeviceRow, resource: string): ResourceCapability | undefined {
  return device.capabilities.resources?.find((r) => r.name === resource);
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  // List view: registry metadata plus EdgeX admin/operating state, fetched
  // once for every device (not per-resource - that's the detail view's job).
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

  // Detail view: registry metadata, the live value of every declared
  // resource (read straight from EdgeX core-command), and each resource's
  // Dual Devices Model state (AUTO/MANUAL, valueAuto/valueManual).
  app.get<{ Params: { id: string } }>("/devices/:id", async (request, reply) => {
    const device = await findDevice(request.params.id);
    if (!device) {
      return reply.code(404).send({ error: "device not found" });
    }

    const resources: Record<string, unknown> = {};
    const dualState: Record<string, dualDevicesModel.ResourceState> = {};
    if (device.edgex_device_name) {
      const edgexDeviceName = device.edgex_device_name;
      await Promise.all(
        (device.capabilities.resources ?? []).map(async (resourceCap) => {
          const resource = resourceCap.name;
          try {
            resources[resource] = await readResource(edgexDeviceName, resource);
          } catch (err) {
            app.log.warn({ err, resource }, "failed to read resource");
            resources[resource] = null;
          }
          // A pure sensor (readOnly) has no AUTO/MANUAL mode at all - no
          // dualState entry, rather than defaulting to a misleading "AUTO".
          if (resourceCap.readOnly) return;
          try {
            dualState[resource] = await dualDevicesModel.getState(device.id, resource);
          } catch (err) {
            app.log.warn({ err, resource }, "failed to read Dual Devices Model state");
          }
        }),
      );
    }

    return { ...device, resources, dualState };
  });

  // Write path (UI-driven): Model State Validator, then Dual Devices Model
  // setManualActive (a direct UI write *is* what puts a resource into
  // MANUAL - see AGENTS.md section 6), then proxy to EdgeX core-command.
  // Used today by the dev simulator page to override a virtual device's
  // sensor values.
  app.put<{ Params: { id: string; resource: string }; Body: { value: unknown } }>(
    "/devices/:id/resources/:resource",
    async (request, reply) => {
      const { resource } = request.params;
      const { value } = request.body;
      if (value === undefined) {
        return reply.code(400).send({ error: "request body must include a 'value'" });
      }

      const device = await requireEdgeXDevice(request.params.id, reply);
      if (!device) return;

      if (findResourceCapability(device, resource)?.readOnly) {
        return reply
          .code(400)
          .send({ error: `resource '${resource}' is read-only - it has no AUTO/MANUAL mode`, hint: "use .../simulate for dev testing" });
      }

      // Logged as an attempt, not just a success (AGENTS.md section 22) -
      // a rejected command is often the more interesting thing to audit,
      // so this runs before the forbidden-state/EdgeX checks below, not
      // gated on them succeeding.
      await logCommand({ deviceId: device.id, resource, action: "write", value, source: "api" });

      const forbidden = await checkForbidden(device, resource, value, device.edgex_device_name, app.log);
      if (!forbidden.ok) {
        return reply.code(409).send({ error: "forbidden state", reason: forbidden.reason });
      }

      const state = await dualDevicesModel.setManualActive(device.id, resource, value);
      if (!(await writeOrReject(reply, device.edgex_device_name, resource, value))) return;
      return { status: "ok", state };
    },
  );

  // Dev-only path for readOnly (sensor) resources: writes straight through
  // to EdgeX, bypassing the Dual Devices Model entirely - a pure sensor has
  // no AUTO/MANUAL concept (see the ResourceCapability comment above), so
  // this exists purely to let the Dev Simulator inject a new simulated
  // reading for a virtual device, the same way a physical sensor would push
  // a new value on its own.
  app.put<{ Params: { id: string; resource: string }; Body: { value: unknown } }>(
    "/devices/:id/resources/:resource/simulate",
    async (request, reply) => {
      const { resource } = request.params;
      const { value } = request.body;
      if (value === undefined) {
        return reply.code(400).send({ error: "request body must include a 'value'" });
      }

      const device = await requireEdgeXDevice(request.params.id, reply);
      if (!device) return;

      if (!findResourceCapability(device, resource)?.readOnly) {
        return reply
          .code(400)
          .send({ error: `resource '${resource}' is not read-only`, hint: `use PUT .../resources/${resource} instead` });
      }

      await logCommand({ deviceId: device.id, resource, action: "simulate", value, source: "api" });

      if (!(await writeOrReject(reply, device.edgex_device_name, resource, value))) return;
      // No Dual Devices Model state for a readOnly resource, but the new
      // reading still needs to reach the state:* cache and nexus.events -
      // otherwise this device could never do what it exists to test
      // (AGENTS.md section 9): pushing a live value change onto the bus.
      await dualDevicesModel.publishReading(device.id, resource, value, "api");
      return { status: "ok" };
    },
  );

  // Orchestrator-driven equivalent of the write path above: records
  // valueAuto, but only reaches EdgeX if the resource is currently in AUTO
  // mode (a manual override keeps winning until released). Called every
  // tick by apps/orchestrator/src/processes/temperatureControl.ts.
  app.put<{ Params: { id: string; resource: string }; Body: { value: unknown } }>(
    "/devices/:id/resources/:resource/auto",
    async (request, reply) => {
      const { resource } = request.params;
      const { value } = request.body;
      if (value === undefined) {
        return reply.code(400).send({ error: "request body must include a 'value'" });
      }

      const device = await requireEdgeXDevice(request.params.id, reply);
      if (!device) return;

      if (findResourceCapability(device, resource)?.readOnly) {
        return reply.code(400).send({ error: `resource '${resource}' is read-only - it has no AUTO/MANUAL mode` });
      }

      await logCommand({ deviceId: device.id, resource, action: "auto", value, source: "api" });

      const forbidden = await checkForbidden(device, resource, value, device.edgex_device_name, app.log);
      if (!forbidden.ok) {
        return reply.code(409).send({ error: "forbidden state", reason: forbidden.reason });
      }

      const state = await dualDevicesModel.setActive(device.id, resource, value);
      if (state.mode === "AUTO") {
        if (!(await writeOrReject(reply, device.edgex_device_name, resource, value))) return;
      }
      return { status: "ok", state };
    },
  );

  // Releases a resource from MANUAL back to AUTO - the orchestrator's last
  // computed valueAuto takes over immediately.
  app.post<{ Params: { id: string; resource: string } }>(
    "/devices/:id/resources/:resource/release",
    async (request, reply) => {
      const { resource } = request.params;

      const device = await requireEdgeXDevice(request.params.id, reply);
      if (!device) return;

      if (findResourceCapability(device, resource)?.readOnly) {
        return reply.code(400).send({ error: `resource '${resource}' is read-only - it has no AUTO/MANUAL mode` });
      }

      await logCommand({ deviceId: device.id, resource, action: "release", source: "api" });

      const state = await dualDevicesModel.release(device.id, resource);
      if (state.valueAuto !== undefined) {
        const forbidden = await checkForbidden(device, resource, state.valueAuto, device.edgex_device_name, app.log);
        if (!forbidden.ok) {
          return reply.code(409).send({ error: "forbidden state", reason: forbidden.reason });
        }
        if (!(await writeOrReject(reply, device.edgex_device_name, resource, state.valueAuto))) return;
      }
      return { status: "ok", state };
    },
  );

  // System-wide aggregate of every resource's mode (AGENTS.md section 6).
  // The full resource list comes from Postgres (the source of truth for
  // what resources exist) - a resource untouched in Redis is implicitly
  // AUTO, not simply absent from the count.
  app.get("/system/mode", async () => {
    const result = await pool.query<Pick<DeviceRow, "id" | "capabilities">>("SELECT id, capabilities FROM devices");
    const resources = result.rows.flatMap((device) =>
      (device.capabilities.resources ?? [])
        .filter((resourceCap) => !resourceCap.readOnly)
        .map((resourceCap) => ({ deviceId: device.id, resource: resourceCap.name })),
    );
    return { mode: await dualDevicesModel.systemMode(resources) };
  });
}

async function findDevice(id: string): Promise<DeviceRow | undefined> {
  const result = await pool.query<DeviceRow>("SELECT * FROM devices WHERE id = $1", [id]);
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
  resource: string,
  value: unknown,
): Promise<boolean> {
  try {
    await writeResource(edgexDeviceName, resource, value);
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

async function checkForbidden(
  device: DeviceRow,
  resource: string,
  value: unknown,
  edgexDeviceName: string,
  log: FastifyBaseLogger,
): Promise<{ ok: true } | { ok: false; reason?: string }> {
  const rules = device.capabilities.forbidden ?? [];
  if (rules.length === 0) {
    return { ok: true };
  }

  const currentValues: Record<string, unknown> = {};
  await Promise.all(
    resourcesNeededFor(rules, resource).map(async (name) => {
      currentValues[name] = await dualDevicesModel.resolveActiveValue(device.id, name, async () => {
        try {
          return (await readResource(edgexDeviceName, name)).value;
        } catch (err) {
          log.warn({ err, resource: name }, "Model State Validator: failed to read current value");
          return undefined;
        }
      });
    }),
  );

  return validateWrite(rules, resource, value, currentValues);
}
