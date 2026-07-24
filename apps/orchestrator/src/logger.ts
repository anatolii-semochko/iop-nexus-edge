import pino from "pino";

// Separate from Fastify's request-scoped logger: the tick loop runs
// outside any HTTP request and needs somewhere to log regardless.
export const logger = pino({ name: "orchestrator" });
