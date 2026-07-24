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

  // "permanent" processes have no min/max concept enforced here - the type
  // is the same jsonb shape for every kind (loose, like devices.
  // capabilities), min/max only apply to the two temperature-* kinds today.
  app.patch<{ Params: { id: string }; Body: { min?: number; max?: number } }>(
    "/processes/:id/config",
    async (request, reply) => {
      const process = await findProcess(request.params.id);
      if (!process) {
        return reply.code(404).send({ error: "process not found" });
      }

      const min = request.body.min ?? process.config.min;
      const max = request.body.max ?? process.config.max;
      if (min !== undefined && max !== undefined && max < min) {
        return reply.code(400).send({ error: "max cannot be less than min" });
      }

      const config: ProcessConfig = { ...process.config, min, max };
      await pool.query("UPDATE processes SET config = $1, updated_at = now() WHERE id = $2", [config, process.id]);
      return { status: "ok", config };
    },
  );

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
}

async function findProcess(id: string): Promise<ProcessRow | undefined> {
  const result = await pool.query<ProcessRow>(`${PROCESS_SELECT} WHERE p.id = $1`, [id]);
  return result.rows[0];
}

async function withLiveState(process: ProcessRow) {
  const [status, critical] = await Promise.all([
    process.type === "controllable" ? processRegistry.getStatus(process.id) : Promise.resolve(undefined),
    processRegistry.getCritical(process.id),
  ]);
  return { ...process, status, critical };
}
