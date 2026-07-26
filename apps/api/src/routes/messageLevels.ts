import type { FastifyInstance } from "fastify";

import { pool } from "../db.js";

// Message Levels (AGENTS.md section 22) - a FIXED 8-row matrix (type x
// level, seeded by the migration), not an admin-addable/removable list -
// only `mode`/`periodDeciseconds` are ever edited here, no create/delete.
// Config-storage only for now: nothing in this app actually reads these
// values yet to play a sound (that delivery mechanism is still deferred,
// same as the `messenger` process kind AGENTS.md section 22 already names
// as future work).

type MessageLevelType = "warning" | "error";
const VALID_TYPES: MessageLevelType[] = ["warning", "error"];
const VALID_MODES = ["off", "constant", "shortBeep", "longBeep"];

interface MessageLevelRow {
  type: MessageLevelType;
  level: number;
  mode: string;
  period_deciseconds: number;
}

export async function messageLevelRoutes(app: FastifyInstance): Promise<void> {
  app.get("/message-levels", async () => {
    const result = await pool.query<MessageLevelRow>(
      "SELECT * FROM message_levels ORDER BY type DESC, level",
    );
    return result.rows;
  });

  app.patch<{
    Params: { type: string; level: string };
    Body: { mode: string; periodDeciseconds: number };
  }>("/message-levels/:type/:level", async (request, reply) => {
    const { type, level } = request.params;
    const { mode, periodDeciseconds } = request.body;

    if (!VALID_TYPES.includes(type as MessageLevelType)) {
      return reply.code(404).send({ error: "message level not found" });
    }
    if (!VALID_MODES.includes(mode)) {
      return reply.code(400).send({ error: "mode must be one of: " + VALID_MODES.join(", ") });
    }

    const result = await pool.query<MessageLevelRow>(
      `UPDATE message_levels SET mode = $1, period_deciseconds = $2
       WHERE type = $3 AND level = $4
       RETURNING *`,
      [mode, periodDeciseconds ?? 0, type, Number(level)],
    );
    if (!result.rows[0]) return reply.code(404).send({ error: "message level not found" });
    return result.rows[0];
  });
}
