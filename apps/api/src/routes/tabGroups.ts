import type { FastifyInstance } from "fastify";

import { pool } from "../db.js";

// Tab Groups (AGENTS.md section 22) - an operator's own curated workspace
// (whichever processes they personally want to watch), distinct from both
// process_groups (routes/processGroups.ts, the technical system a process
// belongs to) and message_groups (routes/messageGroups.ts, WEM notification
// routing). Ordered (unlike process_groups, which is alphabetical only) -
// `position` drives both this list's own order and the Processes page's
// dynamic per-group tab order. No auth gate here, same as every other
// devices/nodes/processes route (AGENTS.md section 13).

interface TabGroupRow {
  id: number;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as { code: string }).code === "23505";
}

// Deliberate per-row N+1 here, not a single array_agg/GROUP BY query -
// matches processGroups.ts's own withDeletable idiom for the same shape of
// problem (AGENTS.md section 12: list volumes are tens of rows, not
// thousands, so the simpler query style wins).
async function withProcessIds(group: TabGroupRow) {
  const result = await pool.query<{ process_id: number }>(
    "SELECT process_id FROM process_tab_groups WHERE tab_group_id = $1",
    [group.id],
  );
  return { ...group, processIds: result.rows.map((row) => row.process_id) };
}

export async function tabGroupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/tab-groups", async () => {
    const result = await pool.query<TabGroupRow>("SELECT * FROM tab_groups ORDER BY position");
    return Promise.all(result.rows.map(withProcessIds));
  });

  app.post<{ Body: { name: string } }>("/tab-groups", async (request, reply) => {
    const name = request.body.name?.trim();
    if (!name) return reply.code(400).send({ error: "name is required" });

    try {
      // Position computed inside the INSERT itself, not a separate
      // SELECT-then-INSERT round trip - avoids two concurrent creates
      // landing on the same position.
      const result = await pool.query<TabGroupRow>(
        `INSERT INTO tab_groups (name, position)
         SELECT $1, COALESCE(MAX(position) + 1, 0) FROM tab_groups
         RETURNING *`,
        [name],
      );
      return reply.code(201).send(await withProcessIds(result.rows[0]));
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: "a tab group with this name already exists" });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/tab-groups/:id",
    async (request, reply) => {
      const name = request.body.name?.trim();
      if (!name) return reply.code(400).send({ error: "name is required" });

      try {
        const result = await pool.query<TabGroupRow>(
          "UPDATE tab_groups SET name = $1, updated_at = now() WHERE id = $2 RETURNING *",
          [name, request.params.id],
        );
        if (!result.rows[0]) return reply.code(404).send({ error: "tab group not found" });
        return withProcessIds(result.rows[0]);
      } catch (err) {
        if (isUniqueViolation(err)) {
          return reply.code(409).send({ error: "a tab group with this name already exists" });
        }
        throw err;
      }
    },
  );

  // Freely deletable any time - unlike process_groups there's no "must be
  // empty" rule here; ON DELETE CASCADE cleans up process_tab_groups.
  app.delete<{ Params: { id: string } }>("/tab-groups/:id", async (request, reply) => {
    const result = await pool.query("DELETE FROM tab_groups WHERE id = $1", [request.params.id]);
    if (result.rowCount === 0) return reply.code(404).send({ error: "tab group not found" });
    return reply.code(204).send();
  });

  // UI-driven reorder (up/down arrows in Settings, AGENTS.md section 22) -
  // takes the *complete* new order, not a single move, so a client-side
  // up/down click just resends the whole array. Validated against the
  // actual current id set (not just trusted) so a stale/incomplete client
  // array can't silently leave some group's position stuck or colliding.
  app.patch<{ Body: { orderedIds: number[] } }>("/tab-groups/reorder", async (request, reply) => {
    const { orderedIds } = request.body;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: existing } = await client.query<{ id: number }>("SELECT id FROM tab_groups");
      const existingIds = new Set(existing.map((row) => row.id));
      const submittedIds = new Set(orderedIds);
      const isExactMatch =
        existingIds.size === submittedIds.size && [...existingIds].every((id) => submittedIds.has(id));
      if (!isExactMatch) {
        await client.query("ROLLBACK");
        return reply.code(400).send({ error: "orderedIds must exactly match the current set of tab group ids" });
      }

      for (const [index, id] of orderedIds.entries()) {
        await client.query("UPDATE tab_groups SET position = $1, updated_at = now() WHERE id = $2", [index, id]);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    return { status: "ok" };
  });
}
