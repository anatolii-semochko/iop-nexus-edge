import { mkdir } from "node:fs/promises";

import fastifyCookie from "@fastify/cookie";
import fastifyJwt from "@fastify/jwt";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";

import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { deviceRoutes } from "./routes/devices.js";
import { messageGroupRoutes } from "./routes/messageGroups.js";
import { messageLevelRoutes } from "./routes/messageLevels.js";
import { nodeRoutes } from "./routes/nodes.js";
import { processGroupRoutes } from "./routes/processGroups.js";
import { processRoutes } from "./routes/processes.js";
import { tabGroupRoutes } from "./routes/tabGroups.js";
import { userRoutes } from "./routes/users.js";

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
await app.register(processGroupRoutes);
await app.register(processRoutes);
await app.register(tabGroupRoutes);
await app.register(messageGroupRoutes);
await app.register(messageLevelRoutes);

app.listen({ port: config.port, host: config.host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
