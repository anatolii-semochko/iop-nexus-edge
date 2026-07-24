import { config } from "./config.js";
import { connectConsumer } from "./rabbitmq.js";
import { buildServer } from "./server.js";

const { app, broadcast } = buildServer();

connectConsumer((event) => broadcast(event));

app.listen({ port: config.port, host: config.host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
