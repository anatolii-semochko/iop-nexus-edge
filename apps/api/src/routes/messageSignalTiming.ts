import type { FastifyInstance } from "fastify";

import { pool } from "../db.js";

// Message Levels redesign (AGENTS_TO_DO.md, 2026-08-01) - the beep-pattern
// timing profile shared by every level/type (how long a short/long beep
// stays on, how long the pause between beeps within a burst is). A one-
// row singleton table (message_signal_timing, migration
// 1690000000042_create-message-signal-timing-table.ts), not per-level -
// there is one buzzer-pattern timing profile for the whole system.
// apps/orchestrator's active-buzzer process reads this fresh every tick,
// same "admin edit takes effect on the next tick" convention as
// message_levels itself.

interface MessageSignalTimingRow {
  id: number;
  short_beep_seconds: number;
  short_beep_pause_seconds: number;
  long_beep_seconds: number;
  long_beep_pause_seconds: number;
}

const NUMERIC_FIELDS = [
  "shortBeepSeconds",
  "shortBeepPauseSeconds",
  "longBeepSeconds",
  "longBeepPauseSeconds",
] as const;

const COLUMN_BY_FIELD: Record<(typeof NUMERIC_FIELDS)[number], string> = {
  shortBeepSeconds: "short_beep_seconds",
  shortBeepPauseSeconds: "short_beep_pause_seconds",
  longBeepSeconds: "long_beep_seconds",
  longBeepPauseSeconds: "long_beep_pause_seconds",
};

export async function messageSignalTimingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/message-signal-timing", async () => {
    const result = await pool.query<MessageSignalTimingRow>(
      "SELECT * FROM message_signal_timing WHERE id = 1",
    );
    return result.rows[0];
  });

  app.patch<{
    Body: Partial<Record<(typeof NUMERIC_FIELDS)[number], number>>;
  }>("/message-signal-timing", async (request, reply) => {
    const updates: string[] = [];
    const values: number[] = [];

    for (const field of NUMERIC_FIELDS) {
      const value = request.body[field];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return reply.code(400).send({ error: `${field} must be a non-negative number` });
      }
      values.push(value);
      updates.push(`${COLUMN_BY_FIELD[field]} = $${values.length}`);
    }

    if (updates.length === 0) {
      return reply.code(400).send({ error: "no fields to update" });
    }

    const result = await pool.query<MessageSignalTimingRow>(
      `UPDATE message_signal_timing SET ${updates.join(", ")} WHERE id = 1 RETURNING *`,
      values,
    );
    return result.rows[0];
  });
}
