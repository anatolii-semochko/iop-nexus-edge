import type { FastifyInstance } from "fastify";

import { requireAuth } from "../auth.js";
import { logCommand } from "../commandLog.js";
import { pool } from "../db.js";
import * as heartbeatControl from "../heartbeatControl.js";
import type { HeartbeatControlConfig } from "../heartbeatControl.js";
import { publishNodeEvent } from "../messaging.js";

interface NodeRow {
  id: number;
  type: string;
  name: string;
  location: string | null;
  bus_type: string | null;
  bus_config: unknown;
  health: string;
  last_heartbeat_at: string | null;
  group_id: number | null;
  heartbeat_control: HeartbeatControlConfig;
  // Library Catalog icon (AGENTS_TO_DO.md, 2026-08-23) - same `library_items`
  // join DevicesList.jsx's own icon column already reads for Devices
  // (routes/devices.ts's SELECT_DEVICE_LIST_BASE), keyed by `kind = 'node'`
  // instead of `'device'`. Null when this node's type has no icon.svg yet
  // (e.g. example-thermal-node).
  icon_path: string | null;
  // Partial physical network (AGENTS_TO_DO.md, 2026-08-09/10) - the
  // switching granularity for every node-attached device at once (see
  // routes/devices.ts's resolveEdgexName) - a device ignores its own
  // `simulated` column entirely once it has a `node_id`.
  simulated: boolean;
  can_enable_simulated: boolean;
  created_at: string;
  updated_at: string;
}

// Heartbeating Control (AGENTS.md section 28) - live Redis state alongside
// the Postgres `heartbeat_control` config already on `node` itself. Read
// here so apps/orchestrator's heartbeat-control process kind gets
// everything it needs from the one `GET /nodes` call it now also makes
// every tick, mirroring how routes/processes.ts's own withLiveState
// already does this for processes. `last_heartbeat_at` (the legacy
// column) is included as-is from `SELECT n.*` above - Postgres/design-
// time-adjacent but written by the same touchNodeHeartbeats call as the
// Redis key below, not a separate concern.
async function withLiveHeartbeat(node: NodeRow) {
  const [heartbeatStopped, heartbeatLastSeenAt] = await Promise.all([
    heartbeatControl.getNodeHeartbeatStopped(node.id),
    heartbeatControl.getNodeLastSeenAt(node.id),
  ]);
  // AGENTS_TO_DO.md, 2026-08-15 - `heartbeatStopped` above is the "monitoring
  // paused" toggle, not a staleness result (see heartbeatControl.ts's own
  // doc comment) - it never flips on a real disconnect. `heartbeatStale` is
  // the actual signal NodesList.jsx's row color should key off of.
  const heartbeatStale = heartbeatControl.nodeHeartbeatStaleness(
    node.heartbeat_control,
    node.simulated,
    heartbeatStopped,
    heartbeatLastSeenAt,
  );
  return { ...node, heartbeatStopped, heartbeatLastSeenAt, heartbeatStale };
}

// Live push (AGENTS.md section 61) - `value` is the whole withLiveHeartbeat
// row, matching NodeEventEnvelope's own "no hand-picked field subset"
// choice. Callers already have this row for their own HTTP response in
// most cases; kept as a separate small helper anyway so a route that
// *doesn't* need to return the row (the broadcast endpoint below) doesn't
// have to fake one.
async function publishNodeState(node: Awaited<ReturnType<typeof withLiveHeartbeat>>, source: string): Promise<void> {
  await publishNodeEvent({
    domain: "node",
    entityId: node.id,
    value: node,
    timestamp: new Date().toISOString(),
    source,
  });
}

// Resolved group name joined in, not a separate per-row fetch - the list
// view (NodesList.jsx) needs it for every row up front, unlike the
// per-process Tab/Message Group membership (routes/processes.ts), which
// is only fetched on-demand when a Settings popup opens.
// `can_enable_simulated` (2026-08-09/10, renamed from `has_simulated_twin`
// 2026-08-23 - AGENTS_TO_DO.md) - computed here rather than forcing
// NodesList.jsx to fetch every node's devices just to know whether its
// own simulated switch should be enabled (that list is only fetched
// today for the per-row detail expansion, not up front for every row -
// see DevicesList.jsx's own SELECT_DEVICE_LIST_BASE for the same
// "resolve everything the list view needs in one query" idiom). Mirrors
// PATCH /nodes/:id/simulated's own guard below EXACTLY (same NOT EXISTS
// shape, not just "some twin exists somewhere") - the original
// `has_simulated_twin` version of this only checked for the presence of
// ANY twin, which blocked a node with zero physical devices (e.g.
// weather-node before any hardware exists) from ever enabling simulated
// mode at all, since it could never have a twin to begin with. A stale
// client-side switch state disabled on such a node even after the PATCH
// route itself was fixed to allow it - this field has to encode the
// exact same condition as the write path, not a looser proxy for it.
const SELECT_NODE = `
  SELECT n.*, g.name AS group_name, li.icon_path,
    NOT EXISTS(
      SELECT 1 FROM devices d
      WHERE d.node_id = n.id AND d.backend = 'physical' AND d.edgex_device_name_simulated IS NULL
    ) AS can_enable_simulated
  FROM nodes n
  LEFT JOIN node_groups g ON g.id = n.group_id
  LEFT JOIN library_items li ON li.type_name = n.type AND li.kind = 'node'
`;

async function findNode(id: string) {
  const result = await pool.query(`${SELECT_NODE} WHERE n.id = $1`, [id]);
  return result.rows[0];
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as { code: string }).code === "23505";
}

export async function nodeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/nodes", async () => {
    const result = await pool.query<NodeRow>(`${SELECT_NODE} ORDER BY n.name`);
    return Promise.all(result.rows.map(withLiveHeartbeat));
  });

  app.get<{ Params: { id: string } }>("/nodes/:id", async (request, reply) => {
    const { id } = request.params;

    const node = await findNode(id);
    if (!node) {
      return reply.code(404).send({ error: "node not found" });
    }

    const devicesResult = await pool.query("SELECT * FROM devices WHERE node_id = $1 ORDER BY name", [id]);
    return { ...(await withLiveHeartbeat(node)), devices: devicesResult.rows };
  });

  // Node-side counterpart of POST /processes/heartbeat (routes/
  // processes.ts) - the control-node's own permanent process calls this
  // once per tick, only when that node's `Heartbeat` device resource
  // actually changed since the last tick (AGENTS_TO_DO.md, 2026-08-09).
  app.post<{ Body: { nodeIds: number[] } }>("/nodes/heartbeat", async (request) => {
    await heartbeatControl.touchNodeHeartbeats(request.body.nodeIds);
    return { status: "ok" };
  });

  // A Node is a physical workplace served locally by exactly one group of
  // Nodes (AGENTS_TO_DO.md, 2026-08-01) - single assignment, unlike a
  // Device's multiple Device Group memberships (routes/devices.ts).
  // Assigned from this Node's own per-row Settings popup.
  app.patch<{ Params: { id: string }; Body: { groupId: number | null } }>(
    "/nodes/:id/group",
    async (request, reply) => {
      const result = await pool.query<{ id: number }>(
        "UPDATE nodes SET group_id = $1, updated_at = now() WHERE id = $2 RETURNING id",
        [request.body.groupId, request.params.id],
      );
      if (!result.rows[0]) return reply.code(404).send({ error: "node not found" });
      const node = await withLiveHeartbeat(await findNode(request.params.id));
      await publishNodeState(node, "node-group-changed");
      return node;
    },
  );

  // Partial physical network (AGENTS_TO_DO.md, 2026-08-09/10) - toggles
  // this node's simulated redirect for every device attached to it at
  // once (the switching granularity confirmed with the user - a device
  // never drifts out of sync with its own physical neighbors). Rejected
  // when the node has at least one `physical` device but not one single
  // device anywhere on it has a simulated twin provisioned - otherwise
  // turning simulated on would silently be a no-op (resolveEdgexName,
  // routes/devices.ts, falls back to the physical name for any device
  // with no twin), which would look like a bug, not a deliberate choice.
  // Original 2026-08-09/10 check, unchanged for any node with physical
  // devices - e.g. control-node, which has 2 (`pulse`/`heartbeat`, no
  // twins of their own) but passes via its other 2 twinned devices
  // (`led-green`/`temperature`) - the check is "some redirect happens
  // somewhere on this node", not "every physical device has its own
  // twin".
  //
  // A node with NO physical devices at all (every device already
  // `backend: virtual`, e.g. weather-node before any hardware exists -
  // AGENTS_TO_DO.md, 2026-08-23) skips this check entirely: there is
  // nothing for a twin to redirect away from, so requiring one here would
  // just be friction, not a no-op guard against real confusion. `simulated`
  // still does real work for such a node even with zero twins - it's what
  // suppresses Heartbeating Control's staleness alarm for a node that has
  // no firmware yet to ever send a real heartbeat (heartbeatControl.ts's
  // `nodeHeartbeatStaleness`: `if (simulated) return "ok"`) - a second,
  // independent use of this same flag, not contingent on any device
  // redirect happening at all.
  // No `log_command` row (that table has no `node_id` column - a bigger
  // schema change not attempted in this pass) - `value` carries the
  // node's own name instead, for at least some audit context.
  app.patch<{ Params: { id: string }; Body: { simulated: boolean } }>(
    "/nodes/:id/simulated",
    { preHandler: requireAuth },
    async (request, reply) => {
      const node = await findNode(request.params.id);
      if (!node) return reply.code(404).send({ error: "node not found" });

      // `node` already carries `can_enable_simulated` (SELECT_NODE) -
      // the exact same condition NodesList.jsx's own switch disables on,
      // computed once, in one place, rather than re-derived here with its
      // own separate query that could silently drift out of sync with it.
      if (request.body.simulated && !node.can_enable_simulated) {
        return reply.code(409).send({ error: "no device on this node has a simulated twin provisioned" });
      }

      await logCommand({
        action: request.body.simulated ? "simulated-on" : "simulated-off",
        value: { nodeId: node.id, nodeName: node.name },
        source: "api",
        actorUserId: request.user.sub,
      });

      const result = await pool.query<{ id: number }>(
        "UPDATE nodes SET simulated = $1, updated_at = now() WHERE id = $2 RETURNING id",
        [request.body.simulated, request.params.id],
      );
      if (!result.rows[0]) return reply.code(404).send({ error: "node not found" });
      // No auto-activation of attached simulation processes here anymore
      // (2026-08-29, reversed from an earlier design) - a simulation
      // process's own ON/OFF is exclusively operator-controlled (the
      // Simulator page's own switch, POST /processes/:id/action), fully
      // independent of this toggle. Whether it's actually producing data
      // right now is a live COMBINATION of that switch and this node's own
      // `simulated` flag (simulationTarget.ts's isSimulationTargetSimulated,
      // read fresh by both the orchestrator's runner and the Simulator
      // page's Active/Sleep label) - never a second write to the same
      // Redis status the switch owns.
      const updated = await withLiveHeartbeat(await findNode(request.params.id));
      await publishNodeState(updated, request.body.simulated ? "node-simulated-on" : "node-simulated-off");
      return updated;
    },
  );

  // Renaming, from the same per-node Settings popup as the group
  // assignment above (AGENTS_TO_DO.md, 2026-08-01 filter-row/Config
  // follow-up). `nodes.name` is UNIQUE, same 409 handling as every named-
  // entity rename in this app (processGroups.ts etc).
  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/nodes/:id/name",
    async (request, reply) => {
      const name = request.body.name?.trim();
      if (!name) return reply.code(400).send({ error: "name is required" });

      try {
        const result = await pool.query<{ id: number }>(
          "UPDATE nodes SET name = $1, updated_at = now() WHERE id = $2 RETURNING id",
          [name, request.params.id],
        );
        if (!result.rows[0]) return reply.code(404).send({ error: "node not found" });
        const node = await withLiveHeartbeat(await findNode(request.params.id));
        await publishNodeState(node, "node-renamed");
        return node;
      } catch (err) {
        if (isUniqueViolation(err)) {
          return reply.code(409).send({ error: "a node with this name already exists" });
        }
        throw err;
      }
    },
  );

  // `location` was display-only (NodesList.jsx's own column, and the
  // row-detail JSON dump) with no write path anywhere until now
  // (AGENTS_TO_DO.md, 2026-08-23) - same per-node Settings popup as the
  // rename route above, no uniqueness to worry about (unlike `name`).
  // Empty string normalizes to NULL, matching how the list column already
  // falls back to '-' for a null location rather than showing an empty
  // cell.
  app.patch<{ Params: { id: string }; Body: { location: string | null } }>(
    "/nodes/:id/location",
    async (request, reply) => {
      const location = request.body.location?.trim() || null;

      const result = await pool.query<{ id: number }>(
        "UPDATE nodes SET location = $1, updated_at = now() WHERE id = $2 RETURNING id",
        [location, request.params.id],
      );
      if (!result.rows[0]) return reply.code(404).send({ error: "node not found" });
      const node = await withLiveHeartbeat(await findNode(request.params.id));
      await publishNodeState(node, "node-location-changed");
      return node;
    },
  );

  // Orchestrator-driven push for the OTHER kind of node change - not a
  // discrete write (those already publish above), but a passive staleness-
  // tier transition (AGENTS.md section 61). Nothing "happens" at the exact
  // moment a node crosses its heartbeat threshold - the orchestrator's own
  // heartbeat-control process kind is the only thing that evaluates this
  // every tick (apps/orchestrator/src/processes/heartbeatControl.ts), so it
  // diffs against the previous tick's result itself and calls this only for
  // node ids whose tier actually changed - mirrors POST /processes/state/
  // broadcast's own "forced" shape, just scoped to specific ids instead of
  // the whole fleet (a node's own row is cheap to refetch individually,
  // unlike the process snapshot's single assembled blob).
  app.post<{ Body: { nodeIds: number[]; reason?: string } }>("/nodes/state/broadcast", async (request) => {
    await Promise.all(
      request.body.nodeIds.map(async (id) => {
        const node = await findNode(String(id));
        if (!node) return;
        await publishNodeState(await withLiveHeartbeat(node), request.body.reason ?? "heartbeat-stale-changed");
      }),
    );
    return { status: "ok" };
  });
}
