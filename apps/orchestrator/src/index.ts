import Fastify from "fastify";

import { apiClient, type ProcessRecord } from "./apiClient.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { runResourceMonitor } from "./processes/resourceMonitor.js";
import { runTemperatureControl } from "./processes/temperatureControl.js";
import { runTemperatureMonitor } from "./processes/temperatureMonitor.js";

const TICK_INTERVAL_MS = 1000;

// process.kind -> its control-loop function (AGENTS.md section 10). Not a
// generic plugin system yet (that's future work per AGENTS.md section 4's
// "plugin lifecycle") - just the fixed set of kinds that exist today.
const RUNNERS: Record<string, (process: ProcessRecord) => Promise<void>> = {
  "temperature-control": runTemperatureControl,
  "temperature-monitor": runTemperatureMonitor,
  "resource-monitor": runResourceMonitor,
};

async function tick(): Promise<void> {
  let processes: ProcessRecord[];
  try {
    processes = await apiClient.listProcesses();
  } catch (err) {
    logger.warn({ err }, "failed to list processes");
    return;
  }

  await Promise.all(
    processes.map(async (process) => {
      const runner = RUNNERS[process.kind];
      if (!runner) return;
      try {
        await runner(process);
      } catch (err) {
        logger.warn({ err, processId: process.id, kind: process.kind }, "process tick failed");
      }
    }),
  );
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
