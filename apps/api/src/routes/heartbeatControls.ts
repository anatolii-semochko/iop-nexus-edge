import type { FastifyInstance } from "fastify";

import * as heartbeatControl from "../heartbeatControl.js";
import type { EntityType, HeartbeatThreshold } from "../heartbeatControl.js";

const VALID_TYPES: EntityType[] = ["process", "device", "node"];

function isValidType(value: string): value is EntityType {
  return (VALID_TYPES as string[]).includes(value);
}

function isValidThreshold(value: unknown): value is HeartbeatThreshold | null {
  if (value === null) return true;
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return typeof t.numberSkippedTicks === "number" && typeof t.level === "number";
}

// UI surface for AGENTS.md's Heartbeating Control section - the
// "Heartbeating Control" process's own expandable panel is the only
// caller today (no separate top-level page). Deliberately spans all
// three entity tables in one response/one update path rather than three
// parallel route families, per the user's own explicit direction:
// "Екшин збереження приймає параметри type і зберігає зміни у відповідну
// таблицю однаково незалежно від ентіті."
export async function heartbeatControlRoutes(app: FastifyInstance): Promise<void> {
  app.get("/heartbeat-controls", async () => {
    return heartbeatControl.listHeartbeatControls();
  });

  app.patch<{
    Params: { type: string; id: string };
    Body: { warning: HeartbeatThreshold | null; error: HeartbeatThreshold | null };
  }>("/heartbeat-controls/:type/:id", async (request, reply) => {
    const { type, id } = request.params;
    if (!isValidType(type)) {
      return reply.code(400).send({ error: `type must be one of: ${VALID_TYPES.join(", ")}` });
    }
    if (!isValidThreshold(request.body.warning) || !isValidThreshold(request.body.error)) {
      return reply
        .code(400)
        .send({ error: "warning/error must each be either null or {numberSkippedTicks, level}" });
    }

    try {
      const config = await heartbeatControl.updateHeartbeatControl(type, Number(id), {
        warning: request.body.warning,
        error: request.body.error,
      });
      return config;
    } catch (err) {
      if (err instanceof heartbeatControl.NotFoundError) {
        return reply.code(404).send({ error: `${type} not found` });
      }
      throw err;
    }
  });

  // Runtime pause/resume (Redis, not Postgres - "поточний параметр в
  // пам'яті", confirmed with the user) - only ever succeeds for an entity
  // whose own `stoppable` is true, enforced server-side, not just a
  // disabled switch in the UI.
  app.put<{
    Params: { type: string; id: string };
    Body: { stopped: boolean };
  }>("/heartbeat-controls/:type/:id/stopped", async (request, reply) => {
    const { type, id } = request.params;
    if (!isValidType(type)) {
      return reply.code(400).send({ error: `type must be one of: ${VALID_TYPES.join(", ")}` });
    }

    try {
      await heartbeatControl.setMonitoringStopped(type, Number(id), request.body.stopped);
      return { status: "ok" };
    } catch (err) {
      if (err instanceof heartbeatControl.NotFoundError) {
        return reply.code(404).send({ error: `${type} not found` });
      }
      if (err instanceof heartbeatControl.NotStoppableError) {
        return reply.code(400).send({ error: `${type} ${id} is not stoppable` });
      }
      throw err;
    }
  });
}
