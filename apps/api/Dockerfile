FROM node:22-alpine AS base
WORKDIR /workspace
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @nexus-edge/api...

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN pnpm --filter @nexus-edge/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /workspace/apps/api/package.json ./apps/api/package.json
WORKDIR /workspace/apps/api
EXPOSE 3001
CMD ["node", "dist/index.js"]
