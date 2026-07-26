import type { FastifyInstance } from "fastify";

import { pool } from "../db.js";
import * as processMessages from "../processMessages.js";
import * as processRegistry from "../processRegistry.js";

interface ProcessConfig {
  min?: number;
  max?: number;
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
  // Dashboard tab (AGENTS.md section 22) - set once, the instant this
  // process first gets an active WEM entry (processMessages.
  // maybeFlagForDashboard), cleared only via the dashboard-flag DELETE
  // route below.
  dashboard_flagged_at: string | null;
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

  // Orchestrator-driven only, same as /critical above - the shared WEM
  // dedup/reconciliation mechanism (AGENTS.md section 22). A process sends
  // the *complete current set* of codes it considers active for one type
  // each time it re-evaluates, not just newly-appearing ones - see
  // processMessages.syncActiveMessages for how that reconciles into
  // inserted/updated/resolved rows.
  app.post<{
    Params: { id: string };
    Body: {
      type: processMessages.MessageType;
      entries: processMessages.MessageInput[];
      autoResolve?: processMessages.AutoResolveMode;
    };
  }>("/processes/:id/messages", async (request, reply) => {
    const process = await findProcess(request.params.id);
    if (!process) {
      return reply.code(404).send({ error: "process not found" });
    }

    await processMessages.syncActiveMessages(
      process.id,
      request.body.type,
      request.body.entries,
      "orchestrator",
      request.body.autoResolve,
    );
    return { status: "ok" };
  });

  // UI-driven dismiss - `hidden` is a single global flag (confirmed with
  // the user, not per-user), so this hides the message for everyone, not
  // just whoever clicked it. No :id/messages nesting check against
  // `messageId` here - a message's own id is already globally unique,
  // same reasoning as e.g. avatar routes not re-validating the user id.
  app.patch<{ Params: { messageId: string }; Body: { hidden: boolean } }>(
    "/process-messages/:messageId",
    async (request, reply) => {
      try {
        await processMessages.setHidden(Number(request.params.messageId), request.body.hidden);
      } catch (err) {
        if (err instanceof processMessages.MessageNotDismissableError) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
      return { status: "ok" };
    },
  );

  // UI-driven - which Tab Groups (routes/tabGroups.ts) this process is
  // currently curated into (AGENTS.md section 22). Fetched on-demand only
  // when the per-process Settings popup opens, not folded into the main
  // /processes payload above.
  app.get<{ Params: { id: string } }>("/processes/:id/tab-groups", async (request, reply) => {
    const process = await findProcess(request.params.id);
    if (!process) {
      return reply.code(404).send({ error: "process not found" });
    }

    const result = await pool.query<{ tab_group_id: number }>(
      "SELECT tab_group_id FROM process_tab_groups WHERE process_id = $1",
      [process.id],
    );
    return result.rows.map((row) => row.tab_group_id);
  });

  // Replaces the full membership set in one transaction (not incremental
  // add/remove) - matches the checkbox-multiselect popup that's this
  // route's only caller, which always submits the complete new set.
  app.put<{ Params: { id: string }; Body: { tabGroupIds: number[] } }>(
    "/processes/:id/tab-groups",
    async (request, reply) => {
      const process = await findProcess(request.params.id);
      if (!process) {
        return reply.code(404).send({ error: "process not found" });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM process_tab_groups WHERE process_id = $1", [process.id]);
        for (const tabGroupId of request.body.tabGroupIds) {
          await client.query(
            "INSERT INTO process_tab_groups (process_id, tab_group_id) VALUES ($1, $2)",
            [process.id, tabGroupId],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      return { status: "ok" };
    },
  );

  // UI-driven - which Message Groups (routes/messageGroups.ts) this
  // process currently sends its WEM into (AGENTS.md section 22) - separate
  // notion from Tab Groups above, same shape. Fetched on-demand only when
  // the per-process Settings popup opens.
  app.get<{ Params: { id: string } }>("/processes/:id/message-groups", async (request, reply) => {
    const process = await findProcess(request.params.id);
    if (!process) {
      return reply.code(404).send({ error: "process not found" });
    }

    const result = await pool.query<{ message_group_id: number }>(
      "SELECT message_group_id FROM process_message_groups WHERE process_id = $1",
      [process.id],
    );
    return result.rows.map((row) => row.message_group_id);
  });

  // Replaces the full membership set in one transaction - same "complete
  // new set" contract as /tab-groups above.
  app.put<{ Params: { id: string }; Body: { messageGroupIds: number[] } }>(
    "/processes/:id/message-groups",
    async (request, reply) => {
      const process = await findProcess(request.params.id);
      if (!process) {
        return reply.code(404).send({ error: "process not found" });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM process_message_groups WHERE process_id = $1", [process.id]);
        for (const messageGroupId of request.body.messageGroupIds) {
          await client.query(
            "INSERT INTO process_message_groups (process_id, message_group_id) VALUES ($1, $2)",
            [process.id, messageGroupId],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      return { status: "ok" };
    },
  );

  // UI-driven - clears the Dashboard flag (AGENTS.md section 22), but only
  // once this process is actually back to zero active WEM entries; a
  // process still genuinely wrong can't be swept off the Dashboard.
  app.delete<{ Params: { id: string } }>("/processes/:id/dashboard-flag", async (request, reply) => {
    const process = await findProcess(request.params.id);
    if (!process) {
      return reply.code(404).send({ error: "process not found" });
    }

    if (await processMessages.hasActiveEntries(process.id)) {
      return reply.code(400).send({ error: "process still has active WEM entries" });
    }

    await pool.query("UPDATE processes SET dashboard_flagged_at = NULL, updated_at = now() WHERE id = $1", [
      process.id,
    ]);
    return { status: "ok" };
  });
}

async function findProcess(id: string): Promise<ProcessRow | undefined> {
  const result = await pool.query<ProcessRow>(`${PROCESS_SELECT} WHERE p.id = $1`, [id]);
  return result.rows[0];
}

async function withLiveState(process: ProcessRow) {
  const [status, critical, warning, metrics, messages, hasActiveWem] = await Promise.all([
    process.type === "controllable" ? processRegistry.getStatus(process.id) : Promise.resolve(undefined),
    processRegistry.getCritical(process.id),
    processRegistry.getWarning(process.id),
    processRegistry.getMetrics(process.id),
    processMessages.listActiveMessages(process.id),
    // Deliberately not derived from `messages` above - listActiveMessages
    // excludes hidden entries, but the Dashboard flag/unflag rule
    // (AGENTS.md section 22) is symmetric on resolved_at regardless of
    // hidden, so the UI's "can this be removed from Dashboard" check needs
    // this separate, unfiltered signal.
    processMessages.hasActiveEntries(process.id),
  ]);
  return { ...process, status, critical, warning, metrics, messages, hasActiveWem };
}
