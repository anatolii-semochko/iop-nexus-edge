// Central place that reads process.env - see AGENTS.md section 1 ("read
// config once at startup; do not scatter process.env.X reads across the
// codebase"). Every other module imports `config`, never process.env
// directly.

export const config = {
  host: process.env.ORCHESTRATOR_HOST ?? "0.0.0.0",
  port: Number(process.env.ORCHESTRATOR_PORT ?? 3000),
  // The orchestrator never talks to Postgres/Redis/EdgeX directly (AGENTS.md
  // section 4/10) - only to the Devices API, the same as any other client.
  // "api" is the docker-compose *service name* (stable, resolved via
  // Docker's internal DNS) - not API_HOST, which is api's own bind address
  // (0.0.0.0) and isn't reachable from another container. Same pattern
  // apps/ui/nginx.conf.template already uses for the same reason - only the
  // port is templated from env, the hostname is not.
  apiUrl: `http://api:${process.env.API_PORT ?? 3001}`,
  // Extension points (to-do.txt 2026-07-29) - a target project's own
  // process kinds (e.g. nexus-edge-smart-house's temperature-control),
  // scanned by processPlugins.ts. Unset for this repo's own docker-compose
  // (nothing to scan).
  processPlugins: {
    extraDir: process.env.EXTRA_PROCESS_PLUGINS_DIR,
  },
};
