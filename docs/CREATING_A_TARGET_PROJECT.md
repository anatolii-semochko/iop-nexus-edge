# Creating a target project on nexus-edge

Manual checklist for bootstrapping a new project on top of nexus-edge
(Core+Base) - see `to-do.txt`'s extension points design (2026-07-28) for
the reasoning behind each piece. `../nexus-edge-smart-house` (sibling
repo) is the reference example every step below points at - copy from it
rather than starting blank.

This is a checklist, not a generator, on purpose: as of 2026-07-29 there
is exactly one real target project, and the shape below is still
settling (see "Known gaps" at the end). Turn this into a `nexus-edge new
<name>` scaffolding command once a second target project has validated
that the shape is actually stable - building the generator now would
lock in a template that's still one data point.

## 1. Directory + git

- New directory **sibling to `nexus-edge`** (its own git repo), kebab-case
  name, e.g. `../my-project`. Docker build contexts below assume this
  sibling layout - `git clone`/checkout both repos into sibling paths on
  CI too.
- `git init`, add a `.gitignore` (`.env`, `node_modules/`).

## 2. Ports (`.env` / `.env.example`)

Copy `nexus-edge-smart-house/.env.example` as a starting point. Every
port that gets a `ports:` mapping in either compose file must differ
from `nexus-edge`'s own dev stack (and from any other target project
running on the same machine) - offset by e.g. +100 per project.

**Known trap** (hit 2026-07-28 building the UI plugin example):
`EDGEX_CORE_METADATA_PORT` (and the other three `EDGEX_CORE_*_PORT` vars)
are **not** host-port config - `apps/api` uses them as the
container-internal port it connects to (`edgex-core-metadata:59881`
etc.), which is always EdgeX's own fixed default regardless of any host
mapping. Leave these at their standard values
(59881/59880/59882/59890). If you want a host-exposed debug port for one
of them, hardcode a literal, separate port number directly in
`docker-compose.edgex.yml`'s `ports:` line - do not reuse the same env
var for both sides, or `apps/api`'s own EdgeX calls silently fail
(`GET /devices` returns `edgex: null` for every device, `ECONNREFUSED` in
`apps/api`'s logs).

## 3. `docker-compose.yml`

- `postgres`, `redis`, `rabbitmq` - own instances, own named volumes, own
  `container_name` prefix (distinct from `nexus-edge-*` and any other
  project's prefix).
- `orchestrator`, `api`: `build: { context: ../nexus-edge, dockerfile:
  apps/{orchestrator,api}/Dockerfile }` - reused **unmodified**, no fork.
  Both load extensions at runtime (env + volume mount), see step 5.
- `messaging-gateway`: same reuse pattern, needed only if `ui` is
  included (step 6).
- `migrate-extra` (one-off, only if you have a private Postgres seed):
  plain `postgres:16-alpine` + `psql`, waits for `nexus-edge`'s own
  migrations to create the `devices` table, then applies
  `./migrations/*.sql`. Not a second `node-pg-migrate` instance unless
  you actually have an evolving migration history, not just a one-time
  seed - see `nexus-edge-smart-house/docker-compose.yml` for the exact
  retry-loop command.

## 4. `docker-compose.edgex.yml`

Copy `nexus-edge-smart-house/docker-compose.edgex.yml` wholesale and
rename the `smarthouse-` container prefix + `name:` project field. This
is the full EdgeX stack (own instance, not shared with `nexus-edge`'s) -
`device-service` is `build: { context: ../nexus-edge, dockerfile:
apps/device-service/Dockerfile }`, reused unmodified.

## 5. Backend extension points (runtime, no build-time work)

For a private DNP that only needs the generic Device API
(write/auto/simulate) and doesn't need a custom command route:

- `extra-res/{profiles,devices}/` - the EdgeX profile + device-list YAML
  actually loaded (mirrors `nexus-edge`'s own `res/profiles`+
  `res/devices` shape). Mounted into `device-service` via
  `EXTRA_RES_DIR` env + a read-only volume - merged into
  `res/profiles`/`res/devices` at container start
  (`internal/extrares.Merge`, since the EdgeX SDK only ever scans one
  directory).
- `plugins/<name>/` - design-time source of truth, same template every
  `nexus-edge` Library device type uses: `contract.schema.ts`,
  `edgex-device-profile.yaml`, `safety.yaml`, `config/default-state.yaml`,
  `docs/README.md`, `tests/README.md`, `CHANGELOG.md`. Kept in sync by
  hand with `extra-res/` (same two-copy convention `light-regulator`
  etc. use in `nexus-edge` itself).

If the DNP needs a **custom command** beyond the generic Device API, add
`plugins/<name>/api.ts` - a plain Fastify plugin (`export default async
function(app) {...}`), dynamic-imported by `apps/api`'s
`EXTRA_API_PLUGINS_DIR` (env + read-only volume mount of `./plugins`)
at startup. Node's native TypeScript type-stripping means this runs
without a build step. Reuse the already-registered Device API through
`app.inject()` rather than talking to Postgres/EdgeX directly -
`apps/api`'s internal modules aren't exposed through its `package.json`
`exports` (only the `startApiServer()` factory is).

## 6. Process plugins (custom process kinds - only if a device needs active control logic)

Skip this section if your DNPs are all passive (sensors, or actuators
only ever written from the UI/API directly) - a device with no process
watching it still works fine.

- `apps/orchestrator`'s `EXTRA_PROCESS_PLUGINS_DIR` (env, mounted
  read-only, same pattern as `EXTRA_API_PLUGINS_DIR`) is scanned for any
  `plugins/<name>/process.ts`. Default export:
  `(register, { apiClient, logger }) => void` - call
  `register(kind, runnerFn)` once per kind this file owns.
  Dependencies come in as plain function arguments (same reasoning as
  `api.ts`'s `app` argument) - don't `import` anything from
  `@nexus-edge/orchestrator` inside this file, it doesn't need to.
- `nexus-edge-smart-house/plugins/temperature-control/process.ts` is the
  worked example - moved there wholesale from `nexus-edge`'s own
  `apps/orchestrator` (to-do.txt 2026-07-29), the first real DNP-plus-
  process "recipe": a Node + role-mapped Devices (sensor/heater/cooler)
  + two process kinds (`temperature-control`, `temperature-monitor`)
  driving them via `apiClient.setDeviceAuto()`. Copy and rename
  (device names/ids, min/max, sensor role) to build your own version of
  the same pattern rather than starting from scratch - the underlying
  Device *types* (temperature/heater/cooler/switch) already exist in
  `nexus-edge`'s own Library (`devices/nodes/example-thermal-node/`);
  only the specific instance wiring + process logic is what you're
  copying.

## 7. UI extension point (build-time - only if you need a custom control)

A device without a custom `ui/register.js` still shows up automatically
in the generic Devices/DevSimulator pages - **skip this section
entirely if that's enough.**

Unlike the runtime-loaded pieces above, Vite bundles the UI into one
static file at build time - there is no "load a plugin at runtime" for
a browser bundle. This means:

- `plugins/<name>/ui/register.js` - a plain side-effect file (same style
  `nexus-edge`'s own `builtinDeviceTypes.js` uses): imports
  `deviceControls`/`deviceSimulators` from `nexus-edge`'s
  `apps/ui/src/deviceTypeRegistry.js` via a relative path, and its own
  component, and registers it directly. Picked up by `apps/ui`'s
  `pluginDeviceTypes.js` (`import.meta.glob('plugins/*/ui/register.js',
  { eager: true })`) - **the relative import path only resolves inside
  the merged build-time tree the Dockerfile below assembles**, not in
  this repo standalone.
- **Own `apps/ui/Dockerfile`** - copy `nexus-edge-smart-house/apps/ui/
  Dockerfile`. Cannot reuse `nexus-edge`'s own ui Dockerfile unmodified
  (unlike every other service above) - the build needs to see both
  `nexus-edge/apps/ui` and this project's own `plugins/` at once.
- `docker-compose.yml`'s `ui` service: `build: { context: .., dockerfile:
  <this-project>/apps/ui/Dockerfile }` - context is the **shared parent**
  of both sibling repos, not `../nexus-edge` alone (the one place this
  differs from every other service's build block).

A genuine Dashboard *widget* (a standalone tile, not tied to one
device's page) isn't possible yet - there is no generic Dashboard widget
host in `nexus-edge` to plug into. Same `register.js`/glob mechanism will
apply once one exists.

## Known gaps (not blockers, just be aware)

- ~~`nexus-edge`'s own Postgres migrations bundle demo/smoke-test
  fixtures unconditionally~~ - fixed 2026-07-29: gated behind
  `SEED_DEMO_FIXTURES` (unset/false by default, `nexus-edge`'s own local
  `.env` sets it `true`). A fresh target project's database has zero
  devices/nodes and exactly two processes (`resource-monitor`,
  `heartbeat-control`) unless you seed your own, same as
  `nexus-edge-smart-house/migrations/001_seed_motion_sensor.sql` does.
- No `file:`/`workspace:` npm dependency on `@nexus-edge/*` is needed for
  **anything** in this checklist, including a custom process kind
  (section 6) - every extension point here is env/directory-driven at
  runtime or build-time-glob-driven, not a TypeScript import. A real npm
  `file:` link on `@nexus-edge/orchestrator` (its `processRegistry`
  export) remains possible if a target project specifically wants
  tighter integration, but nothing here requires it.
