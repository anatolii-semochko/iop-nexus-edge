FROM node:22-alpine AS base
WORKDIR /workspace
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/ui/package.json apps/ui/package.json
RUN pnpm install --frozen-lockfile --filter @nexus-edge/ui...

FROM deps AS build
COPY apps/ui apps/ui
RUN pnpm --filter @nexus-edge/ui build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /workspace/apps/ui/build /usr/share/nginx/html
COPY apps/ui/nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
