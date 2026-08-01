import type { FastifyInstance } from "fastify";

import { pool } from "../db.js";

// Message Levels (AGENTS.md section 22, beep-count/repeat-seconds redesign
// AGENTS_TO_DO.md 2026-08-01) - a FIXED 8-row matrix (type x level, seeded
// by the migration), not an admin-addable/removable list - only `mode`/
// `beepCount`/`repeatSeconds` are ever edited here, no create/delete.
// apps/orchestrator's active-buzzer process (alarmPolicy.ts) reads this
// table fresh every tick to decide what a sound-output device should be
// doing right now.

type MessageLevelType = "warning" | "error";
const VALID_TYPES: MessageLevelType[] = ["warning", "error"];
const VALID_MODES = ["off", "constant", "shortBeep", "longBeep"];
const BEEP_MODES = new Set(["shortBeep", "longBeep"]);

interface MessageLevelRow {
  type: MessageLevelType;
  level: number;
  mode: string;
  beep_count: number | null;
  repeat_seconds: number;
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
    Body: { mode: string; beepCount: number | null; repeatSeconds: number };
  }>("/message-levels/:type/:level", async (request, reply) => {
    const { type, level } = request.params;
    const { mode, beepCount, repeatSeconds } = request.body;

    if (!VALID_TYPES.includes(type as MessageLevelType)) {
      return reply.code(404).send({ error: "message level not found" });
    }
    if (!VALID_MODES.includes(mode)) {
      return reply.code(400).send({ error: "mode must be one of: " + VALID_MODES.join(", ") });
    }
    // Not applicable outside the two beep modes - stored as null rather
    // than trusting/keeping whatever the client happened to send, same
    // "server owns the not-applicable case" approach as heartbeat/data-
    // logger thresholds' own `level: null` when a threshold is off.
    if (
      BEEP_MODES.has(mode) &&
      (beepCount === null || !Number.isInteger(beepCount) || beepCount < 1 || beepCount > 4)
    ) {
      return reply.code(400).send({ error: "beepCount must be an integer between 1 and 4" });
    }
    const resolvedBeepCount = BEEP_MODES.has(mode) ? beepCount : null;

    const result = await pool.query<MessageLevelRow>(
      `UPDATE message_levels SET mode = $1, beep_count = $2, repeat_seconds = $3
       WHERE type = $4 AND level = $5
       RETURNING *`,
      [mode, resolvedBeepCount, repeatSeconds ?? 0, type, Number(level)],
    );
    if (!result.rows[0]) return reply.code(404).send({ error: "message level not found" });
    return result.rows[0];
  });
}
