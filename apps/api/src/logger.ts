import pino from "pino";

// Separate from Fastify's request-scoped logger: RabbitMQ connection
// lifecycle events and best-effort cache/bus failures (dualDevicesModel.ts,
// messaging.ts) happen outside any HTTP request and need somewhere to log
// regardless.
export const logger = pino({ name: "api" });
