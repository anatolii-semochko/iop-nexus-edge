import type { FastifyInstance } from "fastify";

import { pool } from "../db.js";
import * as processRegistry from "../processRegistry.js";

// Message Groups (AGENTS.md section 22) - WEM notification routing: which
// recipient gets which processes' warnings/errors/messages. Deliberately
// NOT tied to process_groups (the technical system a process belongs to,
// routes/processGroups.ts) - an operator doesn't necessarily watch one
// whole Process Group, so which WEM they care about is its own grouping.
// Also distinct from tab_groups (routes/tabGroups.ts, an operator's
// curated *page tab*) - a process can be in either, both, or neither,
// independently. No `position`/ordering here (unlike tab_groups) - nothing
// in the UI needs these in a specific order, plain alphabetical (matching
// process_groups' own convention) is enough. No auth gate here, same as
// every other devices/nodes/processes route (AGENTS.md section 13).

interface MessageGroupRow {
  id: number;
  name: string;
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
async function withProcessIds(group: MessageGroupRow) {
  const result = await pool.query<{ process_id: number }>(
    "SELECT process_id FROM process_message_groups WHERE message_group_id = $1",
    [group.id],
  );
  return { ...group, processIds: result.rows.map((row) => row.process_id) };
}

export async function messageGroupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/message-groups", async () => {
    const result = await pool.query<MessageGroupRow>("SELECT * FROM message_groups ORDER BY name");
    return Promise.all(result.rows.map(withProcessIds));
  });

  // Alarm Annunciator (AGENTS_TO_DO.md, 2026-08-02) - "does this group
  // currently have an active error/warning", scoped by group membership
  // rather than fleet-wide like Active Zummer's own alarm consumer.
  // Message Groups were purely inert metadata before this - the first
  // thing that actually reads process_message_groups at runtime. Same
  // simplification the existing buzzer already makes (AGENTS.md section
  // 27): a process's critical/warning flag carries no level of its own,
  // so an active flag here always means "level 1" - nothing produces a
  // real level 2-4 today.
  app.get("/message-groups/active-state", async () => {
    const groups = await pool.query<{ id: number }>("SELECT id FROM message_groups");
    return Promise.all(
      groups.rows.map(async (group) => {
        const members = await pool.query<{ process_id: number }>(
          "SELECT process_id FROM process_message_groups WHERE message_group_id = $1",
          [group.id],
        );
        const states = await Promise.all(
          members.rows.map((row) =>
            Promise.all([processRegistry.getCritical(row.process_id), processRegistry.getWarning(row.process_id)]),
          ),
        );
        return {
          id: group.id,
          hasActiveError: states.some(([critical]) => critical),
          hasActiveWarning: states.some(([, warning]) => warning),
        };
      }),
    );
  });

  app.post<{ Body: { name: string } }>("/message-groups", async (request, reply) => {
    const name = request.body.name?.trim();
    if (!name) return reply.code(400).send({ error: "name is required" });

    try {
      const result = await pool.query<MessageGroupRow>(
        "INSERT INTO message_groups (name) VALUES ($1) RETURNING *",
        [name],
      );
      return reply.code(201).send(await withProcessIds(result.rows[0]));
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: "a message group with this name already exists" });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/message-groups/:id",
    async (request, reply) => {
      const name = request.body.name?.trim();
      if (!name) return reply.code(400).send({ error: "name is required" });

      try {
        const result = await pool.query<MessageGroupRow>(
          "UPDATE message_groups SET name = $1, updated_at = now() WHERE id = $2 RETURNING *",
          [name, request.params.id],
        );
        if (!result.rows[0]) return reply.code(404).send({ error: "message group not found" });
        return withProcessIds(result.rows[0]);
      } catch (err) {
        if (isUniqueViolation(err)) {
          return reply.code(409).send({ error: "a message group with this name already exists" });
        }
        throw err;
      }
    },
  );

  // Freely deletable any time - unlike process_groups there's no "must be
  // empty" rule here; ON DELETE CASCADE cleans up process_message_groups.
  app.delete<{ Params: { id: string } }>("/message-groups/:id", async (request, reply) => {
    const result = await pool.query("DELETE FROM message_groups WHERE id = $1", [request.params.id]);
    if (result.rowCount === 0) return reply.code(404).send({ error: "message group not found" });
    return reply.code(204).send();
  });
}
