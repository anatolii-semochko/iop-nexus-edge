// Central place that reads process.env - see AGENTS.md section 1 ("read
// config once at startup; do not scatter process.env.X reads across the
// codebase"). Every other module imports `config`, never process.env
// directly.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  host: process.env.MESSAGING_GATEWAY_HOST ?? "0.0.0.0",
  port: Number(process.env.MESSAGING_GATEWAY_PORT ?? 3030),
  rabbitmq: {
    // Reuses the single RabbitMQ user already provisioned for the whole
    // platform (RABBITMQ_DEFAULT_USER/PASS) - there is only one role today,
    // so a dedicated messaging-gateway user isn't justified yet. Revisit if
    // per-service RabbitMQ permissions become necessary (see AGENTS.md
    // section 9).
    url: `amqp://${required("RABBITMQ_DEFAULT_USER")}:${required("RABBITMQ_DEFAULT_PASS")}@${required("RABBITMQ_HOST")}:${process.env.RABBITMQ_PORT ?? 5672}`,
  },
  redis: {
    host: required("REDIS_HOST"),
    port: Number(process.env.REDIS_PORT ?? 6379),
  },
};
