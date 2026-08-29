import type { FastifyBaseLogger, FastifyInstance } from "fastify";

import { requireAuth } from "../auth.js";
import * as dualDevicesModel from "../dualDevicesModel.js";
import { pool } from "../db.js";
import { getSystemActorUserId, logCommand } from "../commandLog.js";
import { logReading } from "../deviceLog.js";
import * as dataLoggerControl from "../dataLoggerControl.js";
import { EdgeXError, listEdgeXDevices, readValue, writeValue, type EdgeXDeviceStatus } from "../edgex.js";
import { publishDeviceEvent } from "../messaging.js";
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
  // UI redesign (AGENTS_TO_DO.md, 2026-08-14) - `color` (LED's own
  // pre-existing per-instance hint) already meant "which color to show
  // when this boolean device is active"; DevicesList.jsx's new icon
  // column reuses that exact same field for every boolean device type,
  // not just `led`. `physicalId` is a placeholder field only - not read
  // or written by anything yet (DeviceSettingsModal.jsx renders it
  // disabled), reserved for a future real hardware-address concept.
  color?: string;
  physicalId?: string;
}

interface DeviceRow {
  id: number;
  node_id: number | null;
  type: string;
  name: string;
  location: string | null;
  backend: "physical" | "virtual";
  edgex_device_name: string | null;
  // Partial physical network (AGENTS_TO_DO.md, 2026-08-09/10) - a second,
  // opt-in EdgeX registration this device can be redirected to. `simulated`
  // only has independent meaning for a standalone device (`node_id` null);
  // a node-attached device's *effective* simulated-ness always comes from
  // its own node instead (`node_simulated` below, joined in by every query
  // that needs to resolve which name is currently active) - see
  // `resolveEdgexName`.
  simulated: boolean;
  edgex_device_name_simulated: string | null;
  capabilities: DeviceCapabilities;
  data_logger_control: dataLoggerControl.DataLoggerControlConfig;
  created_at: string;
  updated_at: string;
}

/**
 * Which of a device's two possible EdgeX registrations is currently active -
 * the redirect this entire simulated-mode feature is about. A node-attached
 * device ignores its own `simulated` column entirely and defers to its
 * node's (the node is the switching granularity there, confirmed with the
 * user - a device doesn't drift out of sync with its own physical
 * neighbors); a standalone device (`node_id` null) uses its own. Falls back
 * to the physical name whenever no simulated twin is actually provisioned
 * (`edgex_device_name_simulated` null) - "opt-in" needs no separate flag,
 * simulated mode simply has nothing to redirect to for a device that was
 * never given a twin, same as if it were never toggled at all.
 */
export function resolveEdgexName(row: {
  node_id: number | null;
  simulated: boolean;
  node_simulated?: boolean | null;
  edgex_device_name: string | null;
  edgex_device_name_simulated: string | null;
}): string | null {
  const effectiveSimulated = row.node_id !== null ? (row.node_simulated ?? false) : row.simulated;
  if (effectiveSimulated && row.edgex_device_name_simulated) {
    return row.edgex_device_name_simulated;
  }
  return row.edgex_device_name;
}

interface NodeRow {
  id: number;
  forbidden: ForbiddenRule[];
}

interface DeviceListRow extends DeviceRow {
  node_name: string | null;
  node_simulated: boolean | null;
  device_group_ids: number[];
  icon_path: string | null;
}

// Resolved node name plus every Device Group this device belongs to
// (AGENTS_TO_DO.md, 2026-08-01), joined/aggregated in one query rather
// than the per-row N+1 idiom used elsewhere (withDeletable/withProcessIds)
// - this powers the Devices list page's node-name column and group
// filter for every row on every load, a hotter path than an admin
// group-list screen's tens-of-rows fetch. `icon_path` (2026-08-14, UI
// redesign) joins the Library Catalog by `type_name` - the same key
// `usedInProject` (routes/library.ts) already matches against - so the
// list's own icon column stays in sync with whatever the Library
// currently has for this device's type, no separate fetch needed.
const SELECT_DEVICE_LIST_BASE = `
  SELECT d.*, n.name AS node_name, n.simulated AS node_simulated,
    COALESCE(array_agg(dg.device_group_id) FILTER (WHERE dg.device_group_id IS NOT NULL), '{}') AS device_group_ids,
    li.icon_path
  FROM devices d
  LEFT JOIN nodes n ON n.id = d.node_id
  LEFT JOIN device_device_groups dg ON dg.device_id = d.id
  LEFT JOIN library_items li ON li.type_name = d.type AND li.kind = 'device'
`;

// Same node-join every other device query needs to resolve which EdgeX
// registration is actually active (resolveEdgexName) - separate from
// SELECT_DEVICE_LIST_BASE above since call sites here don't need the
// Device Group aggregation/GROUP BY that one carries.
const SELECT_DEVICE_WITH_NODE = `
  SELECT d.*, n.simulated AS node_simulated
  FROM devices d
  LEFT JOIN nodes n ON n.id = d.node_id
`;

/**
 * Computes this reading's overdue status server-side (AGENTS.md section 62 -
 * moves what DevicesList.jsx used to compute client-side, mirroring
 * nodeHeartbeatStaleness's own role for Nodes) and publishes a live `device`
 * event carrying it plus the reading's own value - so a passing tab that
 * already has this device open (or another tab entirely) converges without
 * needing to poll again itself. Always returns the freshly computed values
 * regardless, for the caller's own HTTP response.
 *
 * Publishes unconditionally, not only when isOverdue itself changed - an
 * earlier version gated on that (avoiding "needless" traffic), which
 * quietly broke live *value* updates for the common, healthy case where
 * isOverdue never changes at all: DevicesList.jsx's own live overlay would
 * then never receive anything after the initial mount fetch, even though
 * the value was being read fresh every `periodSeconds` the whole time
 * (found live: a device's displayed value visibly stopped advancing).
 * Unconditional publishing isn't excessive here specifically because
 * every caller is already naturally rate-limited to roughly `periodSeconds`
 * cadence - GET /devices/:id by a page's own one-time mount fetch plus
 * Data Logger's own periodic touch/write (dataLogger.ts's maybeTouch/
 * maybeLog), POST /devices/:id/log by the same write cadence - never a
 * tight per-tick loop.
 */
async function publishDeviceReading(
  device: { id: number; data_logger_control: dataLoggerControl.DataLoggerControlConfig },
  readingOriginMs: number | null,
  value: unknown,
  source: string,
): Promise<{ isOverdue: boolean; expiresAt: number | null }> {
  const result = dataLoggerControl.computeOverdue(device.data_logger_control, readingOriginMs, Date.now());
  await Promise.all([
    publishDeviceEvent({
      domain: "device",
      entityId: device.id,
      value,
      isOverdue: result.isOverdue,
      expiresAt: result.expiresAt,
      timestamp: new Date().toISOString(),
      source,
    }),
    // AGENTS_TO_DO.md, 2026-08-16 - lets GET /devices (the list route)
    // offer a cheap "last known" isOverdue per device, for the Devices
    // list's own status filter, without a live EdgeX read of its own.
    dataLoggerControl.setOverdueSnapshot(device.id, result.isOverdue, result.expiresAt),
  ]);
  return result;
}

/**
 * Publishes a metadata-only `device` event (AGENTS_TO_DO.md, 2026-08-23) -
 * called after any write that changes a device's *registry* fields
 * (rename, Device Group membership, Node assignment, simulated toggle,
 * capabilities), not its reading. Carries the whole list-row shape as
 * `metadata` (not `value` - see messaging.ts's own envelope comment for
 * why conflating the two would corrupt useDeviceLiveState's rendered
 * value), so `DevicesList.jsx` can patch its own row in place instead of
 * needing a full `GET /devices` poll for cross-tab convergence - the
 * same problem section 61 already solved for Nodes' own `simulated`/
 * rename, applied here to Devices.
 */
async function publishDeviceMetadata(deviceId: number, source: string): Promise<void> {
  const row = await findDeviceListRow(String(deviceId));
  if (!row) return;
  await publishDeviceEvent({
    domain: "device",
    entityId: deviceId,
    metadata: row,
    timestamp: new Date().toISOString(),
    source,
  });
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  // List view: registry metadata plus EdgeX admin/operating state, fetched
  // once for every device.
  app.get("/devices", async () => {
    const result = await pool.query<DeviceListRow>(`${SELECT_DEVICE_LIST_BASE} GROUP BY d.id, n.name, n.simulated, li.icon_path ORDER BY d.name`);

    let edgexByName = new Map<string, EdgeXDeviceStatus>();
    try {
      edgexByName = new Map((await listEdgeXDevices()).map((d) => [d.name, d]));
    } catch (err) {
      app.log.warn({ err }, "failed to fetch EdgeX device list; returning registry data without live status");
    }

    // Last-known isOverdue per device (AGENTS_TO_DO.md, 2026-08-16) - for
    // the Devices list's own status filter, which needs a value for every
    // device up front, not just the ones a mounted DeviceRow has already
    // fetched. A snapshot, not live - "unknown yet" (no cache entry)
    // defaults to not-overdue, same stance computeOverdue itself takes.
    const overdueSnapshots = await dataLoggerControl.getOverdueSnapshots(result.rows.map((d) => d.id));

    return result.rows.map((device) => {
      const resolvedEdgexName = resolveEdgexName(device);
      const overdue = overdueSnapshots.get(device.id);
      return {
        ...device,
        edgex: resolvedEdgexName ? (edgexByName.get(resolvedEdgexName) ?? null) : null,
        isOverdue: overdue?.isOverdue ?? false,
      };
    });
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
    // EdgeX's own reading timestamp, ms epoch (AGENTS_TO_DO.md, 2026-08-14
    // UI redesign) - the Devices list's own overdue/staleness highlight
    // needs a reading time that's correct even on a fresh page load, not
    // just "since the WebSocket has been open" (the live overlay's own
    // `timestamp` only reflects events actually received this session).
    let readingOrigin: number | null = null;
    let dualState: dualDevicesModel.DeviceState | null = null;
    let isOverdue = false;
    let expiresAt: number | null = null;
    const resolvedEdgexName = resolveEdgexName(device);
    if (resolvedEdgexName && device.capabilities.edgexResource) {
      const edgexDeviceName = resolvedEdgexName;
      const edgexResource = device.capabilities.edgexResource;
      try {
        const reading = await readValue(edgexDeviceName, edgexResource);
        value = reading.value;
        valueType = reading.valueType;
        units = reading.units ?? null;
        // EdgeX's own `origin` is nanoseconds since epoch (confirmed live,
        // 2026-08-14: a real reading's origin was a 19-digit number) - ms
        // for every JS Date/arithmetic consumer on this side.
        readingOrigin = Math.floor(reading.origin / 1e6);
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
      ({ isOverdue, expiresAt } = await publishDeviceReading(device, readingOrigin, value, "device-read"));
    } else if (device.capabilities.readOnly) {
      // No EdgeX/hardware backend at all (e.g. `light-level`, AGENTS.md
      // section 66) - the only way such a Device's value ever changes is
      // a process calling PUT /devices/:id/reading, which writes
      // straight into the `state:*` cache via
      // dualDevicesModel.publishReading(). Read it back from there
      // instead of a live EdgeX call, which this Device has nothing to
      // resolve to.
      const reading = await dualDevicesModel.getReading(device.id);
      if (reading) {
        value = reading.value;
        readingOrigin = Date.parse(reading.updatedAt);
        ({ isOverdue, expiresAt } = await publishDeviceReading(device, readingOrigin, value, "device-read"));
      }
    }

    return { ...device, value, valueType, units, dualState, readingOrigin, isOverdue, expiresAt };
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
      await logCommand({ deviceId: device.id, action: "write", value, source: "api", actorUserId: request.user.sub });

      const forbidden = await checkForbidden(device, value, app.log);
      if (!forbidden.ok) {
        return reply.code(409).send({ error: "forbidden state", reason: forbidden.reason });
      }

      const state = await dualDevicesModel.setManualActive(device.id, value);
      if (!(await writeOrReject(reply, device.resolvedEdgexName, device.capabilities.edgexResource, value))) return;
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

      await logCommand({ deviceId: device.id, action: "simulate", value, source: "api", actorUserId: request.user.sub });

      if (!(await writeOrReject(reply, device.resolvedEdgexName, device.capabilities.edgexResource, value))) return;
      // No Dual Devices Model state for a readOnly device, but the new
      // reading still needs to reach the state:* cache and nexus.events -
      // otherwise this device could never do what it exists to test
      // (AGENTS.md section 9): pushing a live value change onto the bus.
      await dualDevicesModel.publishReading(device.id, value, "api");
      return { status: "ok" };
    },
  );

  // Orchestrator-driven equivalent of .../simulate above, same "auto" vs
  // bare-route split as .../auto below: a `simulation`-type process (a
  // readOnly Device WITH an EdgeX profile, AGENTS_TO_DO.md 2026-08-29,
  // e.g. aquarium's light-power-actual) needs to push a computed value
  // every tick the same way .../simulate does, but has no user session to
  // authenticate with or attribute a logCommand entry to - unlike a
  // human's Dev Simulator action, a process re-asserting its own computed
  // reading isn't a "command" worth auditing (same reasoning .../reading's
  // own comment gives for not calling logCommand either).
  app.put<{ Params: { id: string }; Body: { value: unknown } }>(
    "/devices/:id/simulate-auto",
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
          .send({ error: `device '${device.name}' is not read-only`, hint: "use PUT /devices/:id/auto instead" });
      }

      if (!(await writeOrReject(reply, device.resolvedEdgexName, device.capabilities.edgexResource, value))) return;
      await dualDevicesModel.publishReading(device.id, value, "process");
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
      await logCommand({ deviceId: device.id, action: "auto", value, source: "api", actorUserId: await getSystemActorUserId() });
    }

    const forbidden = await checkForbidden(device, value, app.log);
    if (!forbidden.ok) {
      return reply.code(409).send({ error: "forbidden state", reason: forbidden.reason });
    }

    const state = await dualDevicesModel.setActive(device.id, value);
    if (state.mode === "AUTO") {
      if (!(await writeOrReject(reply, device.resolvedEdgexName, device.capabilities.edgexResource, value))) return;
    }
    return { status: "ok", state };
  });

  // Orchestrator-driven write for a readOnly device with no EdgeX backend
  // at all - e.g. `light-level` (devices/standalone/sensor/light-level),
  // a categorical value computed by the `weather-control` process from
  // another device's raw reading, added 2026-08-23 (Node Weather
  // Control.txt, AGENTS_TO_DO.md). Neither existing write path fits: PUT
  // .../auto requires a resolvable EdgeX device via requireEdgeXDevice and
  // rejects readOnly devices outright (this route's own check above), and
  // PUT .../simulate ALSO requires a resolvable EdgeX device (it writes
  // the value out to EdgeX, not just the state:* cache - see that route's
  // own writeOrReject call) - neither works for a Device that was never
  // meant to have hardware behind it. This route skips EdgeX entirely and
  // goes straight to dualDevicesModel.publishReading(), the same
  // cache-refresh-and-publish primitive .../simulate already uses for its
  // own state:*/nexus.events side effects.
  //
  // Not logged via logCommand - unlike a human's .../simulate action, a
  // process re-asserting its own computed reading every tick isn't a
  // "command" worth auditing, any more than an ordinary EdgeX-sourced
  // sensor reading is (those are never logged either).
  app.put<{ Params: { id: string }; Body: { value: unknown } }>(
    "/devices/:id/reading",
    async (request, reply) => {
      const { value } = request.body;
      if (value === undefined) {
        return reply.code(400).send({ error: "request body must include a 'value'" });
      }

      const device = await findDevice(request.params.id);
      if (!device) {
        return reply.code(404).send({ error: "device not found" });
      }
      if (!device.capabilities.readOnly) {
        return reply
          .code(400)
          .send({ error: `device '${device.name}' is not read-only`, hint: "use PUT /devices/:id/auto instead" });
      }

      await dualDevicesModel.publishReading(device.id, value, "process");
      return { status: "ok" };
    },
  );

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

      await logCommand({ deviceId: device.id, action: "release", source: "api", actorUserId: request.user.sub });

      const state = await dualDevicesModel.release(device.id);
      if (state.valueAuto !== undefined) {
        const forbidden = await checkForbidden(device, state.valueAuto, app.log);
        if (!forbidden.ok) {
          return reply.code(409).send({ error: "forbidden state", reason: forbidden.reason });
        }
        if (!(await writeOrReject(reply, device.resolvedEdgexName, device.capabilities.edgexResource, state.valueAuto))) return;
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
    const resolvedEdgexName = resolveEdgexName(device);
    if (!resolvedEdgexName || !device.capabilities.edgexResource) {
      return reply.code(400).send({ error: `device '${device.name}' has no EdgeX resource to read` });
    }

    const reading = await readValue(resolvedEdgexName, device.capabilities.edgexResource);
    await logReading({ deviceId: device.id, value: reading.value, source: "data-logger" });
    await dataLoggerControl.touchLastLoggedAt(device.id);
    // AGENTS.md section 62 - this is the orchestrator's own periodic
    // write-cadence read, the other place (besides an on-demand UI GET)
    // this app ever reads a device's live value - piggybacks the same
    // overdue-changed check/publish rather than leaving Data Logger's own
    // reads unable to converge the Devices list live.
    await publishDeviceReading(device, Math.floor(reading.origin / 1e6), reading.value, "data-logger");
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

      await publishDeviceMetadata(device.id, "device-groups-changed");
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
      await publishDeviceMetadata(result.rows[0].id, "device-node-changed");
      return findDeviceListRow(request.params.id);
    },
  );

  // Partial physical network (AGENTS_TO_DO.md, 2026-08-09/10) - toggles
  // this *standalone* device's own simulated redirect. Node is the
  // switching granularity for a node-attached device (confirmed with the
  // user) - rejected here with a pointer to the node-level route instead,
  // not silently accepted and ignored (this device would otherwise still
  // resolve through its node regardless of what this column says -
  // resolveEdgexName never even reads it for a node-attached device -
  // better to fail loudly than let a client believe a no-op call worked).
  app.patch<{ Params: { id: string }; Body: { simulated: boolean } }>(
    "/devices/:id/simulated",
    { preHandler: requireAuth },
    async (request, reply) => {
      const device = await findDevice(request.params.id);
      if (!device) return reply.code(404).send({ error: "device not found" });

      if (device.node_id !== null) {
        return reply
          .code(409)
          .send({ error: "device belongs to a node - toggle the node's own simulated mode instead" });
      }
      if (request.body.simulated && !device.edgex_device_name_simulated) {
        return reply.code(409).send({ error: "device has no simulated twin provisioned" });
      }

      await logCommand({
        deviceId: device.id,
        action: request.body.simulated ? "simulated-on" : "simulated-off",
        source: "api",
        actorUserId: request.user.sub,
      });

      const result = await pool.query<{ id: number }>(
        "UPDATE devices SET simulated = $1, updated_at = now() WHERE id = $2 RETURNING id",
        [request.body.simulated, request.params.id],
      );
      if (!result.rows[0]) return reply.code(404).send({ error: "device not found" });
      // No auto-activation of an attached simulation process here anymore
      // (2026-08-29, reversed from an earlier design) - same reasoning as
      // routes/nodes.ts's own PATCH /:id/simulated: a simulation process's
      // ON/OFF is exclusively operator-controlled, never written by this
      // route.
      await publishDeviceMetadata(result.rows[0].id, "device-simulated-changed");
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
        await publishDeviceMetadata(result.rows[0].id, "device-renamed");
        return findDeviceListRow(request.params.id);
      } catch (err) {
        if (isUniqueViolation(err)) {
          // Scope-neutral on purpose - the unique constraint is now
          // node-scoped for a node-attached device but still global for a
          // standalone one (migration 1690000000052), and this route has
          // no cheap way to tell which case just fired without an extra
          // query.
          return reply.code(409).send({ error: "a device with this name already exists" });
        }
        throw err;
      }
    },
  );

  // Partial jsonb merge onto `capabilities` (AGENTS_TO_DO.md, 2026-08-14
  // UI redesign) - same "loose config, interpreted by the consumer"
  // pattern `processes/:id/config` already uses. Deliberately generic
  // (any capability key, not just `color`/`physicalId`) rather than a
  // narrow endpoint per field - this is admin-only settings, not a hot
  // control-loop path.
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/devices/:id/capabilities",
    { preHandler: requireAuth },
    async (request, reply) => {
      const device = await findDevice(request.params.id);
      if (!device) return reply.code(404).send({ error: "device not found" });

      const capabilities = { ...device.capabilities, ...request.body };
      await logCommand({
        deviceId: device.id,
        action: "config",
        value: request.body,
        source: "api",
        actorUserId: request.user.sub,
      });
      await pool.query("UPDATE devices SET capabilities = $1, updated_at = now() WHERE id = $2", [
        capabilities,
        device.id,
      ]);
      await publishDeviceMetadata(device.id, "device-capabilities-changed");
      return findDeviceListRow(request.params.id);
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

interface DeviceRowWithNode extends DeviceRow {
  node_simulated: boolean | null;
}

async function findDevice(id: string): Promise<DeviceRowWithNode | undefined> {
  const result = await pool.query<DeviceRowWithNode>(`${SELECT_DEVICE_WITH_NODE} WHERE d.id = $1`, [id]);
  return result.rows[0];
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as { code: string }).code === "23505";
}


async function findDeviceListRow(id: string): Promise<DeviceListRow | undefined> {
  const result = await pool.query<DeviceListRow>(
    `${SELECT_DEVICE_LIST_BASE} WHERE d.id = $1 GROUP BY d.id, n.name, n.simulated, li.icon_path`,
    [id],
  );
  return result.rows[0];
}

async function findDeviceByNodeAndName(nodeId: number, name: string): Promise<DeviceRowWithNode | undefined> {
  const result = await pool.query<DeviceRowWithNode>(
    `${SELECT_DEVICE_WITH_NODE} WHERE d.node_id = $1 AND d.name = $2`,
    [nodeId, name],
  );
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
): Promise<(DeviceRowWithNode & { resolvedEdgexName: string }) | undefined> {
  const device = await findDevice(id);
  if (!device) {
    reply.code(404).send({ error: "device not found" });
    return undefined;
  }
  const resolvedEdgexName = resolveEdgexName(device);
  if (!resolvedEdgexName) {
    reply.code(409).send({ error: "device is not backed by EdgeX" });
    return undefined;
  }
  return { ...device, resolvedEdgexName };
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
      const otherResolvedName = other ? resolveEdgexName(other) : null;
      if (!other || !otherResolvedName || !other.capabilities.edgexResource) {
        return;
      }
      const otherEdgexDeviceName = otherResolvedName;
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
