import Fastify from "fastify";

const PORT = Number(process.env.ORCHESTRATOR_PORT ?? 3000);
const HOST = process.env.ORCHESTRATOR_HOST ?? "0.0.0.0";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ status: "ok", service: "orchestrator" }));

app.listen({ port: PORT, host: HOST }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
