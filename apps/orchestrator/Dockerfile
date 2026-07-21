FROM node:22-alpine AS base
WORKDIR /workspace
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/orchestrator/package.json apps/orchestrator/package.json
RUN pnpm install --frozen-lockfile --filter @nexus-edge/orchestrator...

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/orchestrator apps/orchestrator
RUN pnpm --filter @nexus-edge/orchestrator build

FROM base AS prod-deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/orchestrator/package.json apps/orchestrator/package.json
RUN pnpm install --frozen-lockfile --prod --filter @nexus-edge/orchestrator...

FROM base AS runtime
ENV NODE_ENV=production
# pnpm workspaces link deps via symlinks into the root node_modules, so both
# the root and the app-level node_modules must be copied together for the
# symlinks to resolve at runtime.
COPY --from=prod-deps /workspace/node_modules ./node_modules
COPY --from=prod-deps /workspace/apps/orchestrator/node_modules ./apps/orchestrator/node_modules
COPY --from=prod-deps /workspace/apps/orchestrator/package.json ./apps/orchestrator/package.json
COPY --from=build /workspace/apps/orchestrator/dist ./apps/orchestrator/dist
WORKDIR /workspace/apps/orchestrator
EXPOSE 3000
CMD ["node", "dist/index.js"]
