import type { FastifyInstance } from "fastify";

import { redis } from "../redis.js";

// System tick pulse (AGENTS_TO_DO.md, 2026-08-01) - a purely cosmetic
// "the system is alive" signal for the header's green indicator, not a
// data channel. apps/orchestrator's own 1s tick loop (tickInterval.ts)
// calls this once per cycle; the only thing this route does is notify
// apps/messaging-gateway over the same lightweight Redis Pub/Sub idiom
// processBroadcast.ts already uses for process state (SNAPSHOT_UPDATED_
// CHANNEL) - no cache key, no DB read, no assembled payload, since a tick
// pulse carries no meaningful data of its own beyond "one just happened".
export const SYSTEM_TICK_CHANNEL = "system:tick";

export async function systemTickRoutes(app: FastifyInstance): Promise<void> {
  app.post("/system/tick", async () => {
    try {
      await redis.publish(SYSTEM_TICK_CHANNEL, Date.now().toString());
    } catch (err) {
      app.log.warn({ err }, "failed to publish system tick");
    }
    return { status: "ok" };
  });
}
