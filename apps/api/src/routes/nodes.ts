import type { FastifyInstance } from "fastify";

import { pool } from "../db.js";

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
  created_at: string;
  updated_at: string;
}

// Resolved group name joined in, not a separate per-row fetch - the list
// view (NodesList.jsx) needs it for every row up front, unlike the
// per-process Tab/Message Group membership (routes/processes.ts), which
// is only fetched on-demand when a Settings popup opens.
const SELECT_NODE = `
  SELECT n.*, g.name AS group_name
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
    const result = await pool.query(`${SELECT_NODE} ORDER BY n.name`);
    return result.rows;
  });

  app.get<{ Params: { id: string } }>("/nodes/:id", async (request, reply) => {
    const { id } = request.params;

    const node = await findNode(id);
    if (!node) {
      return reply.code(404).send({ error: "node not found" });
    }

    const devicesResult = await pool.query("SELECT * FROM devices WHERE node_id = $1 ORDER BY name", [id]);
    return { ...node, devices: devicesResult.rows };
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
