import type { FastifyInstance } from "fastify";

import * as deviceCommandLog from "../deviceCommandLog.js";
import type { DeviceCommandAction } from "../deviceCommandLog.js";
import * as sensorReadingLog from "../sensorReadingLog.js";

// Read side of the two append-only log tables (AGENTS.md section 22) for
// the Logs page's deviceCommands/sensors tabs (section 29) - the
// processes tab reuses GET /process-messages (routes/processes.ts)
// instead of a third route here, since that endpoint already covers the
// same table/pagination shape.

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
      search?: string;
      from?: string;
      to?: string;
      page?: string;
      pageSize?: string;
    };
  }>("/logs/device-commands", async (request) => {
    const { action, search, from, to } = request.query;
    const deviceId = request.query.deviceId ? Number(request.query.deviceId) : undefined;
    return deviceCommandLog.listDeviceCommandLogs({
      deviceId,
      action,
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
  }>("/logs/sensor-readings", async (request) => {
    const { search, from, to } = request.query;
    const deviceId = request.query.deviceId ? Number(request.query.deviceId) : undefined;
    return sensorReadingLog.listSensorReadingLogs({
      deviceId,
      search,
      from,
      to,
      page: parsePage(request.query.page),
      pageSize: parsePageSize(request.query.pageSize),
    });
  });
}
