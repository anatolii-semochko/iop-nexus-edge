import type { FastifyInstance } from "fastify";

import * as commandLog from "../commandLog.js";
import type { DeviceCommandAction } from "../commandLog.js";
import * as deviceLog from "../deviceLog.js";

// Read side of the two append-only log tables (AGENTS.md section 22,
// renamed in the 2026-07-27 Device/Node refactor) for the Logs page's
// commands/devices tabs (section 29) - the processes tab reuses
// GET /log-messages (routes/processes.ts) instead of a third route here,
// since that endpoint already covers the same table/pagination shape.

function parsePage(value: string | undefined): number {
  return Math.max(1, Number(value ?? 1));
}

function parsePageSize(value: string | undefined): number {
  return Math.min(100, Math.max(1, Number(value ?? 20)));
}

export async function logRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: {
      deviceId?: string;
      action?: DeviceCommandAction;
      actorUserId?: string;
      search?: string;
      from?: string;
      to?: string;
      page?: string;
      pageSize?: string;
    };
  }>("/logs/commands", async (request) => {
    const { action, search, from, to } = request.query;
    const deviceId = request.query.deviceId ? Number(request.query.deviceId) : undefined;
    const actorUserId = request.query.actorUserId ? Number(request.query.actorUserId) : undefined;
    return commandLog.listCommandLogs({
      deviceId,
      action,
      actorUserId,
      search,
      from,
      to,
      page: parsePage(request.query.page),
      pageSize: parsePageSize(request.query.pageSize),
    });
  });

  app.get<{
    Querystring: {
      deviceId?: string;
      search?: string;
      from?: string;
      to?: string;
      page?: string;
      pageSize?: string;
    };
  }>("/logs/devices", async (request) => {
    const { search, from, to } = request.query;
    const deviceId = request.query.deviceId ? Number(request.query.deviceId) : undefined;
    return deviceLog.listDeviceLogs({
      deviceId,
      search,
      from,
      to,
      page: parsePage(request.query.page),
      pageSize: parsePageSize(request.query.pageSize),
    });
  });
}
