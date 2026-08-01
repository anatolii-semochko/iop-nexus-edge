import Fastify, { type FastifyInstance } from "fastify";

import { apiClient, type ProcessRecord } from "./apiClient.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { loadProcessPlugins } from "./processPlugins.js";
import { runActiveBuzzer } from "./processes/activeBuzzer.js";
import { runDataLogger } from "./processes/dataLogger.js";
import { runHeartbeatControl } from "./processes/heartbeatControl.js";
import { runHeartbeatControlTest } from "./processes/heartbeatControlTest.js";
import { runResourceMonitor } from "./processes/resourceMonitor.js";
import { processRegistry } from "./processRegistry.js";
import { TICK_INTERVAL_MS } from "./tickInterval.js";

// Built-in process kinds (AGENTS.md section 10) - registered through the
// same processRegistry a target-project plugin would use (extension
// points design, AGENTS_TO_DO.md 2026-07-28/29). temperature-control/
// temperature-monitor moved out (AGENTS_TO_DO.md 2026-07-29 "chistiy proekt"
// decision) - they were always a demo assembly on top of the example
// Library devices, not a base system capability; nexus-edge-smart-house
// now owns that recipe as its own process plugin (see processPlugins.ts).
function registerBuiltinProcessKinds(): void {
  processRegistry.register("resource-monitor", runResourceMonitor);
  processRegistry.register("active-buzzer", runActiveBuzzer);
  processRegistry.register("heartbeat-control", runHeartbeatControl);
  processRegistry.register("heartbeat-control-test", runHeartbeatControlTest);
  processRegistry.register("data-logger", runDataLogger);
}

async function tick(): Promise<void> {
  // Fire-and-forget, not awaited - a slow/failed publish must never delay
  // this tick's actual process runners below (AGENTS_TO_DO.md, 2026-08-01:
  // purely a cosmetic "system is alive" signal, see apiClient.tick()).
  void apiClient.tick().catch((err) => logger.warn({ err }, "failed to publish system tick"));

  let processes: ProcessRecord[];
  try {
    processes = await apiClient.listProcesses();
  } catch (err) {
    logger.warn({ err }, "failed to list processes");
    return;
  }

  // Heartbeating Control (AGENTS.md) - every process id whose runner
  // completed *without throwing* this tick, collected here and touched
  // once at the end in a single batched call, not one HTTP round trip
  // per process per second.
  const alive: number[] = [];

  await Promise.all(
    processes.map(async (process) => {
      const runner = processRegistry.get(process.kind);
      if (!runner) return;
      try {
        await runner(process);
        alive.push(process.id);
      } catch (err) {
        logger.warn({ err, processId: process.id, kind: process.kind }, "process tick failed");
      }
    }),
  );

  if (alive.length > 0) {
    try {
      await apiClient.touchHeartbeats(alive);
    } catch (err) {
      logger.warn({ err }, "failed to touch process heartbeats");
    }
  }
}

/**
 * Registers the built-in process kinds, starts the tick loop and the
 * (health-check only) HTTP server - the "nexus-edge as a dependency"
 * entrypoint (extension points design, AGENTS_TO_DO.md 2026-07-28). A target
 * project's own process calls processRegistry.register() for its own
 * kinds, then calls this, instead of running this app's own index.ts.
 */
export async function startOrchestrator(): Promise<FastifyInstance> {
  registerBuiltinProcessKinds();
  await loadProcessPlugins();

  setInterval(() => {
    void tick();
  }, TICK_INTERVAL_MS);

  const app = Fastify({ logger: true });
  app.get("/health", async () => ({ status: "ok", service: "orchestrator" }));
  await app.listen({ port: config.port, host: config.host });
  return app;
}
