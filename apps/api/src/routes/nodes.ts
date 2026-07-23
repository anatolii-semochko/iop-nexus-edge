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
  created_at: string;
  updated_at: string;
}

export async function nodeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/nodes", async () => {
    const result = await pool.query<NodeRow>("SELECT * FROM nodes ORDER BY name");
    return result.rows;
  });

  app.get<{ Params: { id: string } }>("/nodes/:id", async (request, reply) => {
    const { id } = request.params;

    const nodeResult = await pool.query<NodeRow>("SELECT * FROM nodes WHERE id = $1", [id]);
    const node = nodeResult.rows[0];
    if (!node) {
      return reply.code(404).send({ error: "node not found" });
    }

    const devicesResult = await pool.query("SELECT * FROM devices WHERE node_id = $1 ORDER BY name", [id]);
    return { ...node, devices: devicesResult.rows };
  });
}
