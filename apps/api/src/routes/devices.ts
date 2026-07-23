import type { FastifyInstance } from "fastify";

import { pool } from "../db.js";
import { listEdgeXDevices, readResource, writeResource, type EdgeXDeviceStatus } from "../edgex.js";
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

  // Detail view: registry metadata plus the live value of every declared
  // resource, read straight from EdgeX core-command.
  app.get<{ Params: { id: string } }>("/devices/:id", async (request, reply) => {
    const device = await findDevice(request.params.id);
    if (!device) {
      return reply.code(404).send({ error: "device not found" });
    }

    const resources: Record<string, unknown> = {};
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
        }),
      );
    }

    return { ...device, resources };
  });

  // Write path: Model State Validator, then proxy to EdgeX core-command.
  // Used today by the dev simulator page to override a virtual device's
  // sensor values.
  app.put<{ Params: { id: string; resource: string }; Body: { value: unknown } }>(
    "/devices/:id/resources/:resource",
    async (request, reply) => {
      const { resource } = request.params;
      const { value } = request.body;

      const device = await findDevice(request.params.id);
      if (!device) {
        return reply.code(404).send({ error: "device not found" });
      }
      if (!device.edgex_device_name) {
        return reply.code(409).send({ error: "device is not backed by EdgeX" });
      }
      const edgexDeviceName = device.edgex_device_name;

      const rules = device.capabilities.forbidden ?? [];
      if (rules.length > 0) {
        const currentValues: Record<string, unknown> = {};
        await Promise.all(
          resourcesNeededFor(rules, resource).map(async (name) => {
            try {
              currentValues[name] = (await readResource(edgexDeviceName, name)).value;
            } catch (err) {
              app.log.warn({ err, resource: name }, "Model State Validator: failed to read current value");
            }
          }),
        );

        const result = validateWrite(rules, resource, value, currentValues);
        if (!result.ok) {
          return reply.code(409).send({ error: "forbidden state", reason: result.reason });
        }
      }

      await writeResource(edgexDeviceName, resource, value);
      return { status: "ok" };
    },
  );
}

async function findDevice(id: string): Promise<DeviceRow | undefined> {
  const result = await pool.query<DeviceRow>("SELECT * FROM devices WHERE id = $1", [id]);
  return result.rows[0];
}
