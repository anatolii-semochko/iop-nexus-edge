import type { FastifyInstance } from "fastify";

import { requireAdmin } from "../auth.js";
import { listSystemCommands, runSystemCommand } from "../systemCommands.js";

// Service->Commands (AGENTS_TO_DO.md, 2026-08-30) - admin-only, same
// requireAdmin preHandler pattern as routes/users.ts. Every command here can
// affect the whole host, not just this app, so there is no non-admin path
// at all (unlike devices/nodes/processes, which stay unauthenticated today).
export async function serviceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAdmin);

  app.get("/service/commands", async () => ({ commands: listSystemCommands() }));

  app.post<{ Params: { id: string } }>("/service/commands/:id/run", async (request, reply) => {
    const { id } = request.params;
    const command = listSystemCommands().find((c) => c.id === id);
    if (!command) {
      return reply.code(404).send({ error: "unknown command" });
    }
    if (!command.enabled) {
      return reply.code(403).send({ error: "command disabled" });
    }
    try {
      await runSystemCommand(id);
      return { ok: true };
    } catch (err) {
      request.log.error(err, `system command ${id} failed`);
      return reply.code(502).send({ error: (err as Error).message });
    }
  });
}
