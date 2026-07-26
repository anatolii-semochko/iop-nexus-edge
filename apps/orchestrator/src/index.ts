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
import { TICK_INTERVAL_MS } from "./tickInterval.js";

// process.kind -> its control-loop function (AGENTS.md section 10). Not a
// generic plugin system yet (that's future work per AGENTS.md section 4's
// "plugin lifecycle") - just the fixed set of kinds that exist today.
const RUNNERS: Record<string, (process: ProcessRecord) => Promise<void>> = {
  "temperature-control": runTemperatureControl,
  "temperature-monitor": runTemperatureMonitor,
  "resource-monitor": runResourceMonitor,
  "active-buzzer": runActiveBuzzer,
  "heartbeat-control": runHeartbeatControl,
  "heartbeat-control-test": runHeartbeatControlTest,
};

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
      const runner = RUNNERS[process.kind];
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
