# NexusEdge — Open Edge Automation Platform

Powered by EdgeCore Runtime.

Edge-first, modular automation platform for building reliable automation
systems across domains (smart house, aquarium, industrial, marine, and more).
The platform itself is not an application — domain solutions are built on top
of it. See `docs/PROJECT_MASTER-1.1.md` for the full architecture and vision, and
`AGENTS.md` for contribution rules and current implementation notes.

## Requirements

- Docker + Docker Compose v2
- Node.js 22 is pinned for the workspace (`.nvmrc`), but all builds and
  services run inside containers — a local Node/pnpm install is not required.

## Quick start

```
cp .env.example .env
make up-all
```

This starts the platform services (PostgreSQL, Redis, RabbitMQ,
orchestrator, api, ui) together with the EdgeX Foundry core stack and its
custom device-service (`apps/device-service`, CAN + Virtual Node Runtime).

See `Makefile` for all available targets and `AGENTS.md` section 8 for
details.

## Repository layout

```
apps/           orchestrator, api, ui, device-service — the deployable platform services
packages/       shared libraries (empty for now)
plugins/        protocol/device-driver/UI/storage/AI plugins (empty for now)
devices/        device/node type definitions for physical & virtual devices,
                see AGENTS.md section 7 (empty for now)
examples/       example configurations (empty for now)
docs/           project documentation (empty for now)
```

## License

Apache License 2.0 — see `LICENSE`. `apps/ui` is based on the CoreUI Free
React Admin Template (MIT) — see `apps/ui/THIRD-PARTY-LICENSE-CoreUI.txt`.
