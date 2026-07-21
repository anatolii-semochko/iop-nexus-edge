import Fastify from "fastify";

const PORT = Number(process.env.API_PORT ?? 3001);
const HOST = process.env.API_HOST ?? "0.0.0.0";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ status: "ok", service: "api" }));

app.listen({ port: PORT, host: HOST }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
