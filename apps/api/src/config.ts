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
  // UI login only (AGENTS.md section 13) - not per-endpoint API
  // authorization, which stays a separate, not-yet-started task.
  auth: {
    jwtSecret: required("JWT_SECRET"),
    tokenTtl: process.env.JWT_EXPIRES_IN ?? "12h",
    cookieName: "nexus_edge_session",
    // Only over HTTPS in production - this platform runs over plain HTTP on
    // a local network today, no TLS termination configured anywhere yet.
    secureCookies: process.env.NODE_ENV === "production",
  },
  uploads: {
    avatarsDir: process.env.AVATAR_UPLOAD_DIR ?? "/workspace/apps/api/uploads/avatars",
    avatarMaxSizeBytes: Number(process.env.AVATAR_MAX_SIZE_BYTES ?? 2 * 1024 * 1024),
  },
  // Fleet-wide process public-state broadcast (AGENTS.md section 24) -
  // independent of the orchestrator's own 1s compute tick. Urgent changes
  // (critical/warning transitions, a new active WEM entry, or an explicit
  // forced broadcast) push immediately regardless of this interval.
  processState: {
    broadcastIntervalMs: Number(process.env.PROCESS_STATE_BROADCAST_INTERVAL_MS ?? 5000),
  },
  // Command-API extension points (extension points design, to-do.txt
  // 2026-07-28) - both scanned for api.ts plugin files by apiPlugins.ts,
  // Library first then private. builtinDevicesDir has no consumers yet
  // (zero api.ts today) but is always scanned - see apiPlugins.ts.
  // extraApiPluginsDir is unset by default (nothing to scan for this
  // repo's own docker-compose); a target project sets it to its own
  // plugins/ directory.
  apiPlugins: {
    builtinDevicesDir: process.env.BUILTIN_DEVICES_DIR ?? "/workspace/devices",
    extraDir: process.env.EXTRA_API_PLUGINS_DIR,
  },
};
