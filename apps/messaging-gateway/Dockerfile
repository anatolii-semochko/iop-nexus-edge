FROM node:22-alpine AS base
WORKDIR /workspace
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/messaging-gateway/package.json apps/messaging-gateway/package.json
RUN pnpm install --frozen-lockfile --filter @nexus-edge/messaging-gateway...

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/messaging-gateway apps/messaging-gateway
RUN pnpm --filter @nexus-edge/messaging-gateway build

FROM base AS prod-deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/messaging-gateway/package.json apps/messaging-gateway/package.json
RUN pnpm install --frozen-lockfile --prod --filter @nexus-edge/messaging-gateway...

FROM base AS runtime
ENV NODE_ENV=production
# pnpm workspaces link deps via symlinks into the root node_modules, so both
# the root and the app-level node_modules must be copied together for the
# symlinks to resolve at runtime.
COPY --from=prod-deps /workspace/node_modules ./node_modules
COPY --from=prod-deps /workspace/apps/messaging-gateway/node_modules ./apps/messaging-gateway/node_modules
COPY --from=prod-deps /workspace/apps/messaging-gateway/package.json ./apps/messaging-gateway/package.json
COPY --from=build /workspace/apps/messaging-gateway/dist ./apps/messaging-gateway/dist
WORKDIR /workspace/apps/messaging-gateway
EXPOSE 3030
CMD ["node", "dist/index.js"]
