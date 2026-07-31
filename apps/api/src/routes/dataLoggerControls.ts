import type { FastifyInstance } from "fastify";

import * as dataLoggerControl from "../dataLoggerControl.js";
import type { DataLoggerSettings, DataLoggerThreshold } from "../dataLoggerControl.js";

function isValidThreshold(value: unknown): value is DataLoggerThreshold | null {
  if (value === null) return true;
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return typeof t.numberSkippedPeriods === "number" && typeof t.level === "number";
}

function isValidPeriod(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && value > 0);
}

// UI surface for AGENTS.md's Data Logger section - the "Data Logger"
// process's own expandable panel is the only caller today (no separate
// top-level page), same convention as Heartbeating Control. Devices only
// (not processes/nodes - AGENTS.md), so unlike heartbeatControlRoutes
// there's no `:type` param, just `:deviceId`.
export async function dataLoggerControlRoutes(app: FastifyInstance): Promise<void> {
  // Registered before the parameterized routes below so "settings" is
  // never mistaken for a :deviceId path segment.
  app.get("/data-logger-controls/settings", async () => {
    return dataLoggerControl.getSettings();
  });

  app.patch<{ Body: Partial<DataLoggerSettings> }>("/data-logger-controls/settings", async (request) => {
    return dataLoggerControl.updateSettings(request.body);
  });

  app.get("/data-logger-controls", async () => {
    return dataLoggerControl.listDataLoggerControls();
  });

  app.patch<{
    Params: { deviceId: string };
    Body: { periodSeconds: number | null; warning: DataLoggerThreshold | null; error: DataLoggerThreshold | null };
  }>("/data-logger-controls/:deviceId", async (request, reply) => {
    if (!isValidPeriod(request.body.periodSeconds)) {
      return reply.code(400).send({ error: "periodSeconds must be either null or a positive number" });
    }
    if (!isValidThreshold(request.body.warning) || !isValidThreshold(request.body.error)) {
      return reply
        .code(400)
        .send({ error: "warning/error must each be either null or {numberSkippedPeriods, level}" });
    }

    try {
      const config = await dataLoggerControl.updateDataLoggerControl(Number(request.params.deviceId), {
        periodSeconds: request.body.periodSeconds,
        warning: request.body.warning,
        error: request.body.error,
      });
      return config;
    } catch (err) {
      if (err instanceof dataLoggerControl.NotFoundError) {
        return reply.code(404).send({ error: "device not found" });
      }
      throw err;
    }
  });

  // Config-level write/ignore switch (Postgres, not Redis - unlike
  // Heartbeating Control's runtime pause/resume, this is a persisted
  // decision, not a live toggle). Refuses to enable while periodSeconds
  // is null, enforced server-side, not just a disabled switch in the UI.
  app.put<{
    Params: { deviceId: string };
    Body: { writeEnabled: boolean };
  }>("/data-logger-controls/:deviceId/write-enabled", async (request, reply) => {
    try {
      const config = await dataLoggerControl.setWriteEnabled(
        Number(request.params.deviceId),
        request.body.writeEnabled,
      );
      return config;
    } catch (err) {
      if (err instanceof dataLoggerControl.NotFoundError) {
        return reply.code(404).send({ error: "device not found" });
      }
      if (err instanceof dataLoggerControl.NoPeriodConfiguredError) {
        return reply.code(400).send({ error: "cannot enable write while periodSeconds is not configured" });
      }
      throw err;
    }
  });
}
