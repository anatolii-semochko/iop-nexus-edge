# nexus-edge

Read `AGENTS.md` (living technical reference — architecture, per-feature
design, section-numbered) and `../AGENTS_TO_DO.md` (shared roadmap/
journal for the whole iot package, Ukrainian) each session. If they ever
disagree on this project's current state, trust `AGENTS.md`.

## Conventions (apply to every file in this repo)

- Comments and text: English only.
- No emoji outside UI code.
- Never hardcode config values (keys, hosts, ports, limits) — env/config
  files only.
- Check `docker ps` before claiming a new host port — sibling projects
  (`../nexus-edge-aquarium`, `../nexus-edge-smart-house`) and an
  unrelated long-running project share this host.

## Local tooling available here

- MCP server `nexus-edge-postgres` (added at `local` scope — private to
  this user/project pair, not committed anywhere) — read-only
  (`--access-mode=restricted`) access to this repo's own dev Postgres
  (`127.0.0.1:55432`, the same instance already wired into PHPStorm's
  Database tool via `.idea/dataSources.xml`). Use it to inspect
  schema/rows directly instead of `docker exec ... psql`. If it's
  missing on a fresh checkout:
  `claude mcp add nexus-edge-postgres -s local -- uvx --with "mcp<2.0" postgres-mcp --access-mode=restricted "postgresql://nexus_edge:<password>@127.0.0.1:55432/nexus_edge"`
  (password from this repo's own `.env`, `POSTGRES_PASSWORD`). Note: the
  published `postgres-mcp` package currently needs `mcp<2.0` pinned — its
  own dependency spec allows `mcp>=1.5.0` with no upper bound, but it
  breaks against the `mcp` 2.x module layout.
- `/stack-status` slash command (defined at the `iot/` level, applies to
  all sibling projects) — `docker compose ps` + recent logs for any
  unhealthy service.
