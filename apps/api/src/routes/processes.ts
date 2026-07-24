import type { FastifyInstance } from "fastify";

import { pool } from "../db.js";
import * as processRegistry from "../processRegistry.js";

interface ProcessConfig {
  min?: number;
  max?: number;
  // Every process (including itself) whose row should highlight when this
  // process raises its critical flag - see the seed migration for why
  // (AGENTS.md section 10).
  linkedProcessIds?: number[];
  // resource-monitor thresholds (AGENTS.md section 21) - percentages, same
  // loose "shape depends on kind" jsonb as min/max above. A threshold of 0
  // (or omitted) means "don't check this metric" - the orchestrator, not
  // this route, is what interprets that.
  cpuMax?: number;
  ramMax?: number;
  diskMax?: number;
  cpuWarnMax?: number;
  ramWarnMax?: number;
  diskWarnMax?: number;
}

interface ProcessRow {
  id: number;
  name: string;
  group_id: number;
  // Joined from process_groups (AGENTS.md section 10/17) - group_name
  // itself isn't a column on this table anymore, groups are a real,
  // independently manageable entity now (routes/processGroups.ts).
  group_name: string;
  type: "controllable" | "permanent";
  kind: string;
  actions: string[];
  device_id: number | null;
  config: ProcessConfig;
  created_at: string;
  updated_at: string;
}

const IMPLEMENTED_ACTIONS = new Set(["ON", "OFF"]);

const PROCESS_SELECT = `
  SELECT p.*, g.name AS group_name
  FROM processes p
  JOIN process_groups g ON g.id = p.group_id
`;

export async function processRoutes(app: FastifyInstance): Promise<void> {
  app.get("/processes", async () => {
    const result = await pool.query<ProcessRow>(`${PROCESS_SELECT} ORDER BY g.name, p.name`);
    return Promise.all(result.rows.map(withLiveState));
  });

  app.get<{ Params: { id: string } }>("/processes/:id", async (request, reply) => {
    const process = await findProcess(request.params.id);
    if (!process) {
      return reply.code(404).send({ error: "process not found" });
    }
    return withLiveState(process);
  });

  // Same endpoint serves every kind's config fields (min/max for
  // temperature-*, cpuMax/ramMax/diskMax for resource-monitor) - the body is
  // a partial patch merged onto whatever's already there, same loose jsonb
  // approach as devices.capabilities. The min<=max guard only fires when a
  // request actually touches min/max.
  app.patch<{
    Params: { id: string };
    Body: {
      min?: number;
      max?: number;
      cpuMax?: number;
      ramMax?: number;
      diskMax?: number;
      cpuWarnMax?: number;
      ramWarnMax?: number;
      diskWarnMax?: number;
    };
  }>("/processes/:id/config", async (request, reply) => {
    const process = await findProcess(request.params.id);
    if (!process) {
      return reply.code(404).send({ error: "process not found" });
    }

    const config: ProcessConfig = { ...process.config, ...request.body };
    if (config.min !== undefined && config.max !== undefined && config.max < config.min) {
      return reply.code(400).send({ error: "max cannot be less than min" });
    }

    await pool.query("UPDATE processes SET config = $1, updated_at = now() WHERE id = $2", [config, process.id]);
    return { status: "ok", config };
  });

  // Only ON/OFF exist today (the two seeded processes need nothing else) -
  // START/PAUSE/STOP are named in the general process concept but not
  // implemented yet.
  app.post<{ Params: { id: string }; Body: { action: string } }>("/processes/:id/action", async (request, reply) => {
    const process = await findProcess(request.params.id);
    if (!process) {
      return reply.code(404).send({ error: "process not found" });
    }

    const { action } = request.body;
    if (!process.actions.includes(action)) {
      return reply.code(400).send({ error: `action '${action}' is not valid for this process`, allowed: process.actions });
    }
    if (!IMPLEMENTED_ACTIONS.has(action)) {
      return reply.code(400).send({ error: `action '${action}' is not implemented yet` });
    }

    await processRegistry.setStatus(process.id, action === "ON" ? "on" : "off", "api");
    return { status: "ok" };
  });

  // Orchestrator-driven only - there is no "make critical" button in the
  // UI, this is how a permanent monitor process (e.g. Temperature Safety
  // Monitor) reports what it found on its last tick.
  app.post<{ Params: { id: string }; Body: { critical: boolean } }>("/processes/:id/critical", async (request, reply) => {
    const process = await findProcess(request.params.id);
    if (!process) {
      return reply.code(404).send({ error: "process not found" });
    }

    await processRegistry.setCritical(process.id, request.body.critical, "orchestrator");
    return { status: "ok" };
  });

  // Same as /critical above, but for the less severe warn threshold
  // (AGENTS.md section 21) - a resource-monitor metric past its warn max
  // but not yet its error max highlights the row yellow, not red.
  app.post<{ Params: { id: string }; Body: { warning: boolean } }>("/processes/:id/warning", async (request, reply) => {
    const process = await findProcess(request.params.id);
    if (!process) {
      return reply.code(404).send({ error: "process not found" });
    }

    await processRegistry.setWarning(process.id, request.body.warning, "orchestrator");
    return { status: "ok" };
  });

  // Orchestrator-driven only, same as /critical above - a resource-monitor
  // process pushes its latest CPU/RAM/disk readings here every tick
  // (AGENTS.md section 21). Published on the message bus unconditionally
  // (processRegistry.setMetrics) - the UI subscribes to the live feed for
  // these now, the same as status/critical/warning, not a separate poll.
  app.post<{ Params: { id: string }; Body: { cpu: number; ram: number; disk: number } }>(
    "/processes/:id/metrics",
    async (request, reply) => {
      const process = await findProcess(request.params.id);
      if (!process) {
        return reply.code(404).send({ error: "process not found" });
      }

      await processRegistry.setMetrics(process.id, request.body, "orchestrator");
      return { status: "ok" };
    },
  );
}

async function findProcess(id: string): Promise<ProcessRow | undefined> {
  const result = await pool.query<ProcessRow>(`${PROCESS_SELECT} WHERE p.id = $1`, [id]);
  return result.rows[0];
}

async function withLiveState(process: ProcessRow) {
  const [status, critical, warning, metrics] = await Promise.all([
    process.type === "controllable" ? processRegistry.getStatus(process.id) : Promise.resolve(undefined),
    processRegistry.getCritical(process.id),
    processRegistry.getWarning(process.id),
    processRegistry.getMetrics(process.id),
  ]);
  return { ...process, status, critical, warning, metrics };
}
