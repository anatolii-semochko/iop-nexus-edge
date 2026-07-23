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
  host: process.env.API_HOST ?? "0.0.0.0",
  port: Number(process.env.API_PORT ?? 3001),
  postgres: {
    host: required("POSTGRES_HOST"),
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: required("POSTGRES_DB"),
    user: required("POSTGRES_USER"),
    password: required("POSTGRES_PASSWORD"),
  },
  redis: {
    host: required("REDIS_HOST"),
    port: Number(process.env.REDIS_PORT ?? 6379),
  },
  rabbitmq: {
    // Reuses the single RabbitMQ user already provisioned for the whole
    // platform (RABBITMQ_DEFAULT_USER/PASS) - see the same note in
    // apps/messaging-gateway/src/config.ts.
    url: `amqp://${required("RABBITMQ_DEFAULT_USER")}:${required("RABBITMQ_DEFAULT_PASS")}@${required("RABBITMQ_HOST")}:${process.env.RABBITMQ_PORT ?? 5672}`,
  },
  edgex: {
    coreMetadataUrl: `http://${required("EDGEX_CORE_METADATA_HOST")}:${process.env.EDGEX_CORE_METADATA_PORT ?? 59881}`,
    coreDataUrl: `http://${required("EDGEX_CORE_DATA_HOST")}:${process.env.EDGEX_CORE_DATA_PORT ?? 59880}`,
    coreCommandUrl: `http://${required("EDGEX_CORE_COMMAND_HOST")}:${process.env.EDGEX_CORE_COMMAND_PORT ?? 59882}`,
  },
};
