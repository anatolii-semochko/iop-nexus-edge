import Fastify from "fastify";

import { apiClient, type ProcessRecord } from "./apiClient.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { runActiveBuzzer } from "./processes/activeBuzzer.js";
import { runHeartbeatControl } from "./processes/heartbeatControl.js";
import { runHeartbeatControlTest } from "./processes/heartbeatControlTest.js";
import { runResourceMonitor } from "./processes/resourceMonitor.js";
import { runTemperatureControl } from "./processes/temperatureControl.js";
import { runTemperatureMonitor } from "./processes/temperatureMonitor.js";
import { processRegistry } from "./processRegistry.js";
import { TICK_INTERVAL_MS } from "./tickInterval.js";

// Built-in process kinds (AGENTS.md section 10) - registered through the
// same processRegistry a target-project plugin would use (extension
// points design, to-do.txt 2026-07-28).
processRegistry.register("temperature-control", runTemperatureControl);
processRegistry.register("temperature-monitor", runTemperatureMonitor);
processRegistry.register("resource-monitor", runResourceMonitor);
processRegistry.register("active-buzzer", runActiveBuzzer);
processRegistry.register("heartbeat-control", runHeartbeatControl);
processRegistry.register("heartbeat-control-test", runHeartbeatControlTest);

async function tick(): Promise<void> {
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

setInterval(() => {
  void tick();
}, TICK_INTERVAL_MS);

const app = Fastify({ logger: true });

app.get("/health", async () => ({ status: "ok", service: "orchestrator" }));

app.listen({ port: config.port, host: config.host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
