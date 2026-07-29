FROM node:22-alpine AS base
WORKDIR /workspace
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/ui/package.json apps/ui/package.json
RUN pnpm install --frozen-lockfile --filter @nexus-edge/ui...

FROM deps AS build
COPY apps/ui apps/ui
# devices/ holds device-type UI components (ui/control, ui/simulator - see
# AGENTS.md section 7) that apps/ui imports directly via the 'devices/'
# alias in vite.config.mjs - needs to be present in the build context too.
COPY devices devices
# UI branding (extension points design, to-do.txt 2026-07-29 "Фаза В") -
# defaults to "NexusEdge" for this repo's own build; a target project's
# own apps/ui/Dockerfile passes its own name as a build arg. Read by
# both src/projectName.js (import.meta.env) and index.html's
# %VITE_PROJECT_NAME% placeholder - Vite sources both from this same
# process.env var at build time.
ARG VITE_PROJECT_NAME=NexusEdge
ENV VITE_PROJECT_NAME=$VITE_PROJECT_NAME
RUN pnpm --filter @nexus-edge/ui build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /workspace/apps/ui/build /usr/share/nginx/html
COPY apps/ui/nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
