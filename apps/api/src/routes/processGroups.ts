import type { FastifyInstance } from "fastify";

import { pool } from "../db.js";

// Process groups (AGENTS.md section 10/17) - a real, admin-managed entity,
// not just a free-text field duplicated on every process row. No auth
// gate here, same as every other devices/nodes/processes route (AGENTS.md
// section 13 - only /auth and /users are gated so far).

interface ProcessGroupRow {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

async function withDeletable(group: ProcessGroupRow) {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*) FROM processes WHERE group_id = $1",
    [group.id],
  );
  return { ...group, deletable: Number(result.rows[0].count) === 0 };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as { code: string }).code === "23505";
}

export async function processGroupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/process-groups", async () => {
    const result = await pool.query<ProcessGroupRow>("SELECT * FROM process_groups ORDER BY name");
    return Promise.all(result.rows.map(withDeletable));
  });

  app.post<{ Body: { name: string } }>("/process-groups", async (request, reply) => {
    const name = request.body.name?.trim();
    if (!name) return reply.code(400).send({ error: "name is required" });

    try {
      const result = await pool.query<ProcessGroupRow>(
        "INSERT INTO process_groups (name) VALUES ($1) RETURNING *",
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
    "/process-groups/:id",
    async (request, reply) => {
      const name = request.body.name?.trim();
      if (!name) return reply.code(400).send({ error: "name is required" });

      try {
        const result = await pool.query<ProcessGroupRow>(
          "UPDATE process_groups SET name = $1, updated_at = now() WHERE id = $2 RETURNING *",
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

  app.delete<{ Params: { id: string } }>("/process-groups/:id", async (request, reply) => {
    const countResult = await pool.query<{ count: string }>(
      "SELECT count(*) FROM processes WHERE group_id = $1",
      [request.params.id],
    );
    if (Number(countResult.rows[0].count) > 0) {
      return reply.code(400).send({ error: "group is not empty" });
    }

    const result = await pool.query("DELETE FROM process_groups WHERE id = $1", [request.params.id]);
    if (result.rowCount === 0) return reply.code(404).send({ error: "group not found" });
    return reply.code(204).send();
  });
}
