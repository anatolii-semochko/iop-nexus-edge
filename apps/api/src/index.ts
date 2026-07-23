import Fastify from "fastify";

import { config } from "./config.js";
import { deviceRoutes } from "./routes/devices.js";
import { nodeRoutes } from "./routes/nodes.js";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ status: "ok", service: "api" }));

await app.register(nodeRoutes);
await app.register(deviceRoutes);

app.listen({ port: config.port, host: config.host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
