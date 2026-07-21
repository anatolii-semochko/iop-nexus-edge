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

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /workspace/apps/orchestrator/dist ./apps/orchestrator/dist
COPY --from=build /workspace/apps/orchestrator/node_modules ./apps/orchestrator/node_modules
COPY --from=build /workspace/apps/orchestrator/package.json ./apps/orchestrator/package.json
WORKDIR /workspace/apps/orchestrator
EXPOSE 3000
CMD ["node", "dist/index.js"]
