import type { FastifyBaseLogger, FastifyInstance } from "fastify";

import { requireAuth } from "../auth.js";
import * as dualDevicesModel from "../dualDevicesModel.js";
import { pool } from "../db.js";
import { logCommand } from "../commandLog.js";
import { logReading } from "../deviceLog.js";
import * as dataLoggerControl from "../dataLoggerControl.js";
import { EdgeXError, listEdgeXDevices, readValue, writeValue, type EdgeXDeviceStatus } from "../edgex.js";
import { devicesNeededFor, validateWrite, type ForbiddenRule } from "../validator.js";

/**
 * A Device's declared capabilities (Postgres `devices.capabilities`) - flat,
 * not an array (AGENTS_TO_DO.md's 2026-07-27 Device/Node refactor): a Device is
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

interface DeviceListRow extends DeviceRow {
  node_name: string | null;
  device_group_ids: number[];
}

// Resolved node name plus every Device Group this device belongs to
// (AGENTS_TO_DO.md, 2026-08-01), joined/aggregated in one query rather
// than the per-row N+1 idiom used elsewhere (withDeletable/withProcessIds)
// - this powers the Devices list page's node-name column and group
// filter for every row on every load, a hotter path than an admin
// group-list screen's tens-of-rows fetch.
const SELECT_DEVICE_LIST_BASE = `
  SELECT d.*, n.name AS node_name,
    COALESCE(array_agg(dg.device_group_id) FILTER (WHERE dg.device_group_id IS NOT NULL), '{}') AS device_group_ids
  FROM devices d
  LEFT JOIN nodes n ON n.id = d.node_id
  LEFT JOIN device_device_groups dg ON dg.device_id = d.id
`;

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  // List view: registry metadata plus EdgeX admin/operating state, fetched
  // once for every device.
  app.get("/devices", async () => {
    const result = await pool.query<DeviceListRow>(`${SELECT_DEVICE_LIST_BASE} GROUP BY d.id, n.name ORDER BY d.name`);

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
    const device = await findDeviceListRow(request.params.id);
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
  app.put<{ Params: { id: string }; Body: { value: unknown } }>(
    "/devices/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
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
      await logCommand({ deviceId: device.id, action: "write", value, source: "api", actorType: "user", actorUserId: request.user.sub });

      const forbidden = await checkForbidden(device, value, app.log);
      if (!forbidden.ok) {
        return reply.code(409).send({ error: "forbidden state", reason: forbidden.reason });
      }

      const state = await dualDevicesModel.setManualActive(device.id, value);
      if (!(await writeOrReject(reply, device.edgex_device_name, device.capabilities.edgexResource, value))) return;
      return { status: "ok", state };
    },
  );

  // Dev-only path for readOnly (sensor) devices: writes straight through to
  // EdgeX, bypassing the Dual Devices Model entirely - a pure sensor has no
  // AUTO/MANUAL concept (see the DeviceCapabilities comment above), so this
  // exists purely to let the Dev Simulator inject a new simulated reading
  // for a virtual device, the same way a physical sensor would push a new
  // value on its own.
  app.put<{ Params: { id: string }; Body: { value: unknown } }>(
    "/devices/:id/simulate",
    { preHandler: requireAuth },
    async (request, reply) => {
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

      await logCommand({ deviceId: device.id, action: "simulate", value, source: "api", actorType: "user", actorUserId: request.user.sub });

      if (!(await writeOrReject(reply, device.edgex_device_name, device.capabilities.edgexResource, value))) return;
      // No Dual Devices Model state for a readOnly device, but the new
      // reading still needs to reach the state:* cache and nexus.events -
      // otherwise this device could never do what it exists to test
      // (AGENTS.md section 9): pushing a live value change onto the bus.
      await dualDevicesModel.publishReading(device.id, value, "api");
      return { status: "ok" };
    },
  );

  // Orchestrator-driven equivalent of the write path above: records
  // valueAuto, but only reaches EdgeX if the device is currently in AUTO
  // mode (a manual override keeps winning until released). Called every
  // tick by whichever control-loop process plugin owns this device (e.g.
  // a target project's own temperature-control - the base platform's own
  // copy was removed in the 2026-07-29 "chistiy proekt" decision).
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

    // A control-loop process re-asserts its computed output every tick by
    // design (so a device that drifted independently still gets corrected
    // next cycle) - not just on change. Logging every one of those
    // reassertions as if it were a new command flooded log_command
    // (41k+ rows observed live in one running project, AGENTS_TO_DO.md
    // 2026-08-01). Only log when valueAuto actually changes - mirrors
    // dualDevicesModel.ts's own publishReading() precedent, which already
    // dropped this exact "log every tick" behavior for log_device in the
    // 2026-07-27 refactor. The reassertion write/publish below still runs
    // every tick regardless - only the audit log entry is suppressed.
    const previousState = await dualDevicesModel.getState(device.id);
    if (JSON.stringify(previousState.valueAuto) !== JSON.stringify(value)) {
      await logCommand({ deviceId: device.id, action: "auto", value, source: "api", actorType: "orchestrator" });
    }

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
  app.post<{ Params: { id: string } }>(
    "/devices/:id/release",
    { preHandler: requireAuth },
    async (request, reply) => {
      const device = await requireEdgeXDevice(request.params.id, reply);
      if (!device) return;

      if (device.capabilities.readOnly) {
        return reply.code(400).send({ error: `device '${device.name}' is read-only - it has no AUTO/MANUAL mode` });
      }

      await logCommand({ deviceId: device.id, action: "release", source: "api", actorType: "user", actorUserId: request.user.sub });

      const state = await dualDevicesModel.release(device.id);
      if (state.valueAuto !== undefined) {
        const forbidden = await checkForbidden(device, state.valueAuto, app.log);
        if (!forbidden.ok) {
          return reply.code(409).send({ error: "forbidden state", reason: forbidden.reason });
        }
        if (!(await writeOrReject(reply, device.edgex_device_name, device.capabilities.edgexResource, state.valueAuto))) return;
      }
      return { status: "ok", state };
    },
  );

  // Called by apps/orchestrator's Data Logger runner (AGENTS.md's Data
  // Logger section) once a device's configured period is actually due -
  // reads the device's own current live value the same way GET
  // /devices/:id does, writes it to `log_device`, and touches this
  // device's `lastLoggedAt` in the same call so the orchestrator doesn't
  // need a second round-trip. Best-effort (mirrors logCommand/logReading
  // themselves) - a logging failure must never surface as a write error
  // to a caller that's only trying to observe, not command, the device.
  app.post<{ Params: { id: string } }>("/devices/:id/log", async (request, reply) => {
    const device = await findDevice(request.params.id);
    if (!device) {
      return reply.code(404).send({ error: "device not found" });
    }
    if (!device.edgex_device_name || !device.capabilities.edgexResource) {
      return reply.code(400).send({ error: `device '${device.name}' has no EdgeX resource to read` });
    }

    const reading = await readValue(device.edgex_device_name, device.capabilities.edgexResource);
    await logReading({ deviceId: device.id, value: reading.value, source: "data-logger" });
    await dataLoggerControl.touchLastLoggedAt(device.id);
    return { status: "ok", value: reading.value };
  });

  // UI-driven - which Device Groups (routes/deviceGroups.ts) this device
  // currently belongs to (AGENTS_TO_DO.md, 2026-08-01) - a device is a
  // logical workplace and can be in several groups at once (shared
  // devices, e.g. a siren in both a "fire" and "intrusion" group).
  // Fetched on-demand only when the per-device Settings popup opens, same
  // shape as processes.ts's tab-groups/message-groups endpoints.
  app.get<{ Params: { id: string } }>("/devices/:id/device-groups", async (request, reply) => {
    const device = await findDevice(request.params.id);
    if (!device) {
      return reply.code(404).send({ error: "device not found" });
    }

    const result = await pool.query<{ device_group_id: number }>(
      "SELECT device_group_id FROM device_device_groups WHERE device_id = $1",
      [device.id],
    );
    return result.rows.map((row) => row.device_group_id);
  });

  // Replaces the full membership set in one transaction (not incremental
  // add/remove) - matches the checkbox-multiselect popup that's this
  // route's only caller, which always submits the complete new set.
  app.put<{ Params: { id: string }; Body: { deviceGroupIds: number[] } }>(
    "/devices/:id/device-groups",
    async (request, reply) => {
      const device = await findDevice(request.params.id);
      if (!device) {
        return reply.code(404).send({ error: "device not found" });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM device_device_groups WHERE device_id = $1", [device.id]);
        for (const deviceGroupId of request.body.deviceGroupIds) {
          await client.query(
            "INSERT INTO device_device_groups (device_id, device_group_id) VALUES ($1, $2)",
            [device.id, deviceGroupId],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      return { status: "ok" };
    },
  );

  // A device may or may not belong to a Node (single, nullable - unchanged
  // from the 2026-07-27 Device/Node refactor); reassigned here from the
  // same per-device Settings popup that edits this device's Device Group
  // memberships above (AGENTS_TO_DO.md, 2026-08-01: "Маппінг груп і нод
  // пристрою відбувається в Config попапі кожного елемента DN").
  app.patch<{ Params: { id: string }; Body: { nodeId: number | null } }>(
    "/devices/:id/node",
    async (request, reply) => {
      const result = await pool.query<{ id: number }>(
        "UPDATE devices SET node_id = $1, updated_at = now() WHERE id = $2 RETURNING id",
        [request.body.nodeId, request.params.id],
      );
      if (!result.rows[0]) return reply.code(404).send({ error: "device not found" });
      return findDeviceListRow(request.params.id);
    },
  );

  // Renaming, from the same per-device Settings popup as the group/node
  // assignment above (AGENTS_TO_DO.md, 2026-08-01 filter-row/Config
  // follow-up). `devices.name` is UNIQUE, same 409 handling as every
  // named-entity rename in this app (processGroups.ts etc).
  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/devices/:id/name",
    async (request, reply) => {
      const name = request.body.name?.trim();
      if (!name) return reply.code(400).send({ error: "name is required" });

      try {
        const result = await pool.query<{ id: number }>(
          "UPDATE devices SET name = $1, updated_at = now() WHERE id = $2 RETURNING id",
          [name, request.params.id],
        );
        if (!result.rows[0]) return reply.code(404).send({ error: "device not found" });
        return findDeviceListRow(request.params.id);
      } catch (err) {
        if (isUniqueViolation(err)) {
          return reply.code(409).send({ error: "a device with this name already exists" });
        }
        throw err;
      }
    },
  );

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

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as { code: string }).code === "23505";
}

async function findDeviceListRow(id: string): Promise<DeviceListRow | undefined> {
  const result = await pool.query<DeviceListRow>(
    `${SELECT_DEVICE_LIST_BASE} WHERE d.id = $1 GROUP BY d.id, n.name`,
    [id],
  );
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
 * Model State Validator, node-scoped (AGENTS_TO_DO.md's 2026-07-27 Device/Node
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
