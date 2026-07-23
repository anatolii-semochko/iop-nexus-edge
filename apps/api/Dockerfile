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

FROM base AS prod-deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --prod --filter @nexus-edge/api...

FROM base AS runtime
ENV NODE_ENV=production
# pnpm workspaces link deps via symlinks into the root node_modules, so both
# the root and the app-level node_modules must be copied together for the
# symlinks to resolve at runtime.
COPY --from=prod-deps /workspace/node_modules ./node_modules
COPY --from=prod-deps /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/api/migrations ./apps/api/migrations
WORKDIR /workspace/apps/api
EXPOSE 3001
# Migrations run on every container start (node-pg-migrate tracks applied
# ones in its own table, so this is a no-op once the schema is current).
# Invoked directly (not via `pnpm run`) - pnpm isn't needed at runtime and
# its own dependency/build-script checks have nothing to do with this app.
CMD ["sh", "-c", "DATABASE_URL=postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@$POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB ./node_modules/.bin/node-pg-migrate up && node dist/index.js"]
