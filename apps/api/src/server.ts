import { mkdir } from "node:fs/promises";

import fastifyCookie from "@fastify/cookie";
import fastifyJwt from "@fastify/jwt";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import { loadApiPlugins } from "./apiPlugins.js";
import { config } from "./config.js";
import { startProcessStateBroadcastLoop } from "./processBroadcast.js";
import { initUnreadCounts } from "./processMessages.js";
import { authRoutes } from "./routes/auth.js";
import { dataLoggerControlRoutes } from "./routes/dataLoggerControls.js";
import { deviceRoutes } from "./routes/devices.js";
import { heartbeatControlRoutes } from "./routes/heartbeatControls.js";
import { logRoutes } from "./routes/logs.js";
import { messageGroupRoutes } from "./routes/messageGroups.js";
import { messageLevelRoutes } from "./routes/messageLevels.js";
import { nodeRoutes } from "./routes/nodes.js";
import { processGroupRoutes } from "./routes/processGroups.js";
import { processRoutes } from "./routes/processes.js";
import { tabGroupRoutes } from "./routes/tabGroups.js";
import { userRoutes } from "./routes/users.js";

/**
 * Builds, wires and starts the whole API service - the "nexus-edge as a
 * dependency" entrypoint (extension points design, AGENTS_TO_DO.md
 * 2026-07-28): a target project's own process imports and calls this
 * directly instead of running this app's own index.ts. Built-in routes,
 * command-API extension points (apiPlugins.ts - Library then private,
 * both driven entirely by config/env, nothing a caller needs to pass
 * here) and the broadcast loop are all set up identically either way -
 * this repo's own index.ts (still the container's actual entrypoint,
 * unchanged) is now just a one-line caller of this function.
 */
export async function startApiServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok", service: "api" }));

  // Created on startup rather than lazily on first upload - one place that
  // can fail loudly at boot instead of on some user's first avatar upload.
  await mkdir(config.uploads.avatarsDir, { recursive: true });

  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: config.auth.jwtSecret,
    cookie: { cookieName: config.auth.cookieName, signed: false },
  });
  await app.register(fastifyMultipart);
  // Avatars, reachable at /uploads/avatars/<file> - proxied by apps/ui's
  // nginx at /api/uploads/... (AGENTS.md section 13), same as every other
  // apps/api route.
  await app.register(fastifyStatic, { root: config.uploads.avatarsDir, prefix: "/uploads/avatars/" });

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(nodeRoutes);
  await app.register(deviceRoutes);
  await app.register(heartbeatControlRoutes);
  await app.register(dataLoggerControlRoutes);
  await app.register(processGroupRoutes);
  await app.register(processRoutes);
  await app.register(tabGroupRoutes);
  await app.register(messageGroupRoutes);
  await app.register(messageLevelRoutes);
  await app.register(logRoutes);

  // Command-API extension points (extension points design, AGENTS_TO_DO.md
  // 2026-07-28) - Library and private DNP api.ts plugins, registered after
  // every built-in route so a plugin can't accidentally shadow one.
  await loadApiPlugins(app);

  // Recomputes the notification center's unread counters from Postgres
  // (AGENTS.md section 25) before the broadcast loop's own first tick reads
  // them - Redis is ephemeral, this is what keeps it from starting stale
  // (or at zero) after a restart.
  await initUnreadCounts();
  startProcessStateBroadcastLoop();

  await app.listen({ port: config.port, host: config.host });
  return app;
}
