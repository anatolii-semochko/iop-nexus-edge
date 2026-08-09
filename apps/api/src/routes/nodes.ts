import type { FastifyInstance } from "fastify";

import { requireAuth } from "../auth.js";
import { logCommand } from "../commandLog.js";
import { pool } from "../db.js";
import * as heartbeatControl from "../heartbeatControl.js";
import type { HeartbeatControlConfig } from "../heartbeatControl.js";

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
  // Partial physical network (AGENTS_TO_DO.md, 2026-08-09/10) - the
  // switching granularity for every node-attached device at once (see
  // routes/devices.ts's resolveEdgexName) - a device ignores its own
  // `simulated` column entirely once it has a `node_id`.
  simulated: boolean;
  has_simulated_twin: boolean;
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
  return { ...node, heartbeatStopped, heartbeatLastSeenAt };
}

// Resolved group name joined in, not a separate per-row fetch - the list
// view (NodesList.jsx) needs it for every row up front, unlike the
// per-process Tab/Message Group membership (routes/processes.ts), which
// is only fetched on-demand when a Settings popup opens.
// `has_simulated_twin` (2026-08-09/10) - computed here rather than
// forcing NodesList.jsx to fetch every node's devices just to know
// whether its own simulated switch should be enabled (that list is
// only fetched today for the per-row detail expansion, not up front for
// every row - see DevicesList.jsx's own SELECT_DEVICE_LIST_BASE for the
// same "resolve everything the list view needs in one query" idiom).
const SELECT_NODE = `
  SELECT n.*, g.name AS group_name,
    EXISTS(SELECT 1 FROM devices d WHERE d.node_id = n.id AND d.edgex_device_name_simulated IS NOT NULL) AS has_simulated_twin
  FROM nodes n
  LEFT JOIN node_groups g ON g.id = n.group_id
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
      return findNode(request.params.id);
    },
  );

  // Partial physical network (AGENTS_TO_DO.md, 2026-08-09/10) - toggles
  // this node's simulated redirect for every device attached to it at
  // once (the switching granularity confirmed with the user - a device
  // never drifts out of sync with its own physical neighbors). Rejected
  // when not one single child device actually has a simulated twin
  // provisioned - otherwise this would silently be a no-op (resolveEdgexName,
  // routes/devices.ts, falls back to the physical name for any device
  // with no twin), which would look like a bug, not a deliberate choice.
  // No `log_command` row (that table has no `node_id` column - a bigger
  // schema change not attempted in this pass) - `value` carries the
  // node's own name instead, for at least some audit context.
  app.patch<{ Params: { id: string }; Body: { simulated: boolean } }>(
    "/nodes/:id/simulated",
    { preHandler: requireAuth },
    async (request, reply) => {
      const node = await findNode(request.params.id);
      if (!node) return reply.code(404).send({ error: "node not found" });

      if (request.body.simulated) {
        const twinCount = await pool.query<{ count: string }>(
          "SELECT count(*) FROM devices WHERE node_id = $1 AND edgex_device_name_simulated IS NOT NULL",
          [request.params.id],
        );
        if (Number(twinCount.rows[0].count) === 0) {
          return reply.code(409).send({ error: "no device on this node has a simulated twin provisioned" });
        }
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
      return withLiveHeartbeat(await findNode(request.params.id));
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
        return findNode(request.params.id);
      } catch (err) {
        if (isUniqueViolation(err)) {
          return reply.code(409).send({ error: "a node with this name already exists" });
        }
        throw err;
      }
    },
  );
}
