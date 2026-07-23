import type { FastifyBaseLogger, FastifyInstance } from "fastify";

import * as dualDevicesModel from "../dualDevicesModel.js";
import { pool } from "../db.js";
import { EdgeXError, listEdgeXDevices, readResource, writeResource, type EdgeXDeviceStatus } from "../edgex.js";
import { resourcesNeededFor, validateWrite, type ForbiddenRule } from "../validator.js";

interface DeviceRow {
  id: number;
  node_id: number | null;
  type: string;
  name: string;
  location: string | null;
  backend: "physical" | "virtual";
  edgex_device_name: string | null;
  capabilities: { resources?: string[]; forbidden?: ForbiddenRule[] };
  created_at: string;
  updated_at: string;
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
        (device.capabilities.resources ?? []).map(async (resource) => {
          try {
            resources[resource] = await readResource(edgexDeviceName, resource);
          } catch (err) {
            app.log.warn({ err, resource }, "failed to read resource");
            resources[resource] = null;
          }
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

      const forbidden = await checkForbidden(device, resource, value, device.edgex_device_name, app.log);
      if (!forbidden.ok) {
        return reply.code(409).send({ error: "forbidden state", reason: forbidden.reason });
      }

      const state = await dualDevicesModel.setManualActive(device.id, resource, value);
      if (!(await writeOrReject(reply, device.edgex_device_name, resource, value))) return;
      return { status: "ok", state };
    },
  );

  // Orchestrator-driven equivalent of the write path above: records
  // valueAuto, but only reaches EdgeX if the resource is currently in AUTO
  // mode (a manual override keeps winning until released). Nothing calls
  // this yet - apps/orchestrator has no automation logic yet - but it's the
  // real Devices API surface for when it does.
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
      (device.capabilities.resources ?? []).map((resource) => ({ deviceId: device.id, resource })),
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
