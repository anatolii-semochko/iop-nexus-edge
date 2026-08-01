import type { FastifyInstance } from "fastify";

import { pool } from "../db.js";

// Node Groups (AGENTS_TO_DO.md, 2026-08-01) - logical/business groups for
// Nodes (heating, ventilation, lighting, garage...), single-FK like
// Process Groups (AGENTS.md section 10/17): a Node is a physical
// workplace served locally by exactly one group of Nodes, so it belongs
// to at most one group at a time.

interface NodeGroupRow {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

async function withDeletable(group: NodeGroupRow) {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*) FROM nodes WHERE group_id = $1",
    [group.id],
  );
  return { ...group, deletable: Number(result.rows[0].count) === 0 };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as { code: string }).code === "23505";
}

export async function nodeGroupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/node-groups", async () => {
    const result = await pool.query<NodeGroupRow>("SELECT * FROM node_groups ORDER BY name");
    return Promise.all(result.rows.map(withDeletable));
  });

  app.post<{ Body: { name: string } }>("/node-groups", async (request, reply) => {
    const name = request.body.name?.trim();
    if (!name) return reply.code(400).send({ error: "name is required" });

    try {
      const result = await pool.query<NodeGroupRow>(
        "INSERT INTO node_groups (name) VALUES ($1) RETURNING *",
        [name],
      );
      return reply.code(201).send(await withDeletable(result.rows[0]));
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: "a group with this name already exists" });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/node-groups/:id",
    async (request, reply) => {
      const name = request.body.name?.trim();
      if (!name) return reply.code(400).send({ error: "name is required" });

      try {
        const result = await pool.query<NodeGroupRow>(
          "UPDATE node_groups SET name = $1, updated_at = now() WHERE id = $2 RETURNING *",
          [name, request.params.id],
        );
        if (!result.rows[0]) return reply.code(404).send({ error: "group not found" });
        return withDeletable(result.rows[0]);
      } catch (err) {
        if (isUniqueViolation(err)) {
          return reply.code(409).send({ error: "a group with this name already exists" });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>("/node-groups/:id", async (request, reply) => {
    const countResult = await pool.query<{ count: string }>(
      "SELECT count(*) FROM nodes WHERE group_id = $1",
      [request.params.id],
    );
    if (Number(countResult.rows[0].count) > 0) {
      return reply.code(400).send({ error: "group is not empty" });
    }

    const result = await pool.query("DELETE FROM node_groups WHERE id = $1", [request.params.id]);
    if (result.rowCount === 0) return reply.code(404).send({ error: "group not found" });
    return reply.code(204).send();
  });
}
