# Unlike apps/api/apps/orchestrator/device-service (runtime directory
# scan/env-driven, nexus-edge's own Dockerfile reused unmodified), the
# UI can't load a plugin at runtime - Vite bundles everything into one
# static JS file at build time. This project's own Dockerfile is
# required (extension points design, AGENTS_TO_DO.md 2026-07-28/29): the build
# needs to see BOTH nexus-edge's source AND this project's own plugins/
# at once. Uses BuildKit's additional_contexts (docker-compose.yml's
# "nexus-edge" named context, pointed at NEXUS_EDGE_SOURCE_PATH) rather
# than a shared parent directory context - works for nexus-edge checked
# out anywhere on disk, not just as a sibling directory (Фаза В).
FROM node:22-alpine AS base
WORKDIR /workspace
RUN corepack enable

FROM base AS deps
COPY --from=nexus-edge pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY --from=nexus-edge apps/ui/package.json apps/ui/package.json
RUN pnpm install --frozen-lockfile --filter @nexus-edge/ui...

FROM deps AS build
COPY --from=nexus-edge apps/ui apps/ui
# devices/ - nexus-edge's own Library UI components (AGENTS.md section
# 7), needed the same way nexus-edge's own Dockerfile needs it.
COPY --from=nexus-edge devices devices
# plugins/ - this project's own DNP UI components, from THIS project's
# own build context (not the nexus-edge named context).
# apps/ui/vite.config.mjs's 'plugins/' alias + pluginDeviceTypes.js's
# import.meta.glob pick this up at build time, the same convention
# nexus-edge's own devices/ uses for built-ins - no nexus-edge code
# change needed per plugin.
COPY plugins plugins
ARG VITE_PROJECT_NAME=NexusEdge
ENV VITE_PROJECT_NAME=$VITE_PROJECT_NAME
RUN pnpm --filter @nexus-edge/ui build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /workspace/apps/ui/build /usr/share/nginx/html
COPY --from=nexus-edge apps/ui/nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
