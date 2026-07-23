import pino from "pino";

// Separate from Fastify's request-scoped logger: RabbitMQ connection
// lifecycle events (connect/disconnect/reconnect) happen outside any HTTP
// request and need somewhere to log regardless.
export const logger = pino({ name: "messaging-gateway" });
