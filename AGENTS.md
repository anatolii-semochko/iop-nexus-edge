# AGENTS.md

Rules and context for anyone (human or AI agent) working in this repository.
Read this file before making changes. Keep it updated: whenever you add an
important service, module, component, or make an architectural change, update
this file and `README.md` accordingly.

See `docs/PROJECT_MASTER-1.1.md` for the full architecture vision, and
`docs/DEVELOPMENT_LOG.md` for the dated history of how this platform got
to its current state and why.

Section numbers below have a few historical gaps (§8, §12, §14, §16, §18
don't exist) - some early sections were merged/reworked before this file
settled into its current shape, and the numbers were never backfilled.
Deliberately left as-is, not a sign anything is missing: "AGENTS.md
section N" is referenced ~190 times in code comments across this repo, so
renumbering (or splitting this file by domain, otherwise a reasonable
idea at its current size) would mean rewriting every one of those for a
purely cosmetic fix - not worth it.

---

## 1. Mandatory rules

- **All code, comments, identifiers and commit messages are in English.**
  Exceptions must be explicit (e.g. domain docs written for a Ukrainian-speaking
  team may stay in Ukrainian).
- **Never hardcode configuration values** (hosts, ports, credentials, limits,
  URLs, etc.) in source code. All configuration comes from environment
  variables (`.env`, see `.env.example`) or config files. Read config once at
  startup; do not scatter `process.env.X` reads across the codebase.
- **Everything is built and run inside containers.** Do not assume a local
  Node/pnpm toolchain — the only supported entry points are `make` targets
  wrapping `docker compose`. Dockerfiles are the source of truth for how a
  service is built and started.
- **Branch strategy:** `main` is always stable/deployable. All changes land
  via a branch + PR, and every merge into `main` must pass CI. No direct
  pushes to `main`.

## 2. Repository layout

```
apps/           deployable applications (orchestrator, api, ui)
packages/       shared libraries consumed by apps/plugins (empty for now)
plugins/        protocol/device-driver/UI/storage/AI plugins (empty for now)
devices/        device/node type definitions for physical & virtual devices,
                see section 7 (empty for now)
examples/       example configurations / usage (empty for now)
docs/           architecture vision (PROJECT_MASTER-1.1.md) and screenshots (images/)
```

This repo is the **platform only**. Domain applications (e.g. Smart House)
are separate repositories/projects built on top of this platform.

## 3. Tech stack (pinned)

- Node.js **22** (`.nvmrc`), TypeScript
- pnpm workspaces + Turborepo (monorepo)
- Fastify (backend HTTP), Pino (logging)
- PostgreSQL 16 (Device Registry persistence)
- Redis 7 (Dual Devices Model state store, plus the `state:*` last-known-value
  cache from section 9)
- RabbitMQ 4 (Event Bus — `nexus.events` topic exchange, see section 9),
  `amqp-connection-manager`/`amqplib` as the client
- `@fastify/websocket` (UI-facing realtime push, `apps/messaging-gateway`)
- React + Vite, based on CoreUI Free React Admin Template (`apps/ui`)
- EdgeX Foundry **Palau (4.0.2)**, no-security profile (see section 5)
- License: Apache-2.0. `apps/ui` includes third-party CoreUI template code
  under MIT — see `apps/ui/THIRD-PARTY-LICENSE-CoreUI.txt`.

## 4. Apps

- `apps/orchestrator` — Node.js Orchestrator. Owns automation/business logic,
  device lifecycle, command execution, plugin lifecycle. Does not talk to
  hardware protocols directly — nor to Postgres/Redis/EdgeX at all, only to
  `apps/api` (see section 10, "Processes / Orchestration", for its first
  real logic: a 1-second tick loop driving/monitoring processes).
- `apps/api` — Device API / local API. Internal domain abstraction over
  devices (normalization, validation, unit conversion, capabilities).
- `apps/ui` — local React web interface (CoreUI-based), must remain usable
  without any cloud dependency.
- `apps/device-service` — Go, EdgeX Device SDK. The custom EdgeX
  device-service from sections 5-6: hosts the CAN bus transport and the
  Virtual Node Runtime side by side, switching per device. The only non-Node
  service in the repo, and the only one with its own `go.mod`.
- `apps/messaging-gateway` — Node.js. The realtime messaging service from
  section 9: consumes the shared RabbitMQ event bus and fans events out to
  the UI over WebSocket. No database, no EdgeX client — deliberately the
  lightest process in the stack, isolated from Devices API's request/response
  load.

Each app builds and runs only via its `Dockerfile`, orchestrated by
`docker-compose.yml` (`apps/device-service` via `docker-compose.edgex.yml`
instead, since it is meaningless without the EdgeX stack it plugs into).

## 5. EdgeX Foundry integration

- Version: **Palau (4.0.2)**, `no-secty` (no-security) profile — security
  stack (API Gateway, Secret Store) is disabled since authn/authz for the
  platform itself is handled by our own layer (JWT/Casbin, see
  docs/PROJECT_MASTER-1.1.md section 16). Revisit before any external/production
  exposure.
- `docker-compose.edgex.yml` runs only the minimum core needed as a
  protocol/hardware abstraction hub: `core-metadata`, `core-data`,
  `core-command`, `core-keeper` (registry/config), plus their required
  dependencies (`core-common-config-bootstrapper`, EdgeX's own Postgres
  instance, and the Mosquitto broker `core-keeper` uses as its internal
  message bus). Demo/optional EdgeX services (device-rest, device-virtual,
  app-rules-engine, ekuiper rules engine, support-notifications,
  support-scheduler, edgex-ui) are intentionally left out.
- Config values (image tags, env vars) were taken from the official
  generated compose file at `edgexfoundry/edgex-compose`, `palau` branch,
  `docker-compose-no-secty.yml` — do not hand-edit EdgeX service definitions
  without cross-checking that source.
- **No official EdgeX device service exists for CAN bus.** The first
  physical driver (CANable Pro V1, USB-to-CAN) requires writing a **custom
  EdgeX device service** using the EdgeX Device SDK (Go). This is a
  standalone, non-trivial task — do not assume it comes "for free" with the
  EdgeX stack above. This same device-service also hosts the Virtual Node
  Runtime (per-device physical/virtual switch — see section 6), so it is
  needed earlier than the CAN hardware itself.

## 6. Dual Devices Model (core domain concept)

Data flow:

```
Physical Device -> Node -> Bus Transport (CAN first)  --\
                                                          >-- device-service --> EdgeX --> Device API --> Orchestrator <-> UI
Virtual Device  -> Virtual Node -> Virtual Node Runtime --/
```

The UI also reaches Device API directly (telemetry, and commands for devices
currently in `MANUAL`), and has a direct channel to the Orchestrator for
managing automation processes themselves (start/stop/pause scenarios and
workflows) — separate from per-device control.

**EdgeX has no native physical/virtual switching.** Every EdgeX device is
bound to exactly one device-service; there is no built-in way to swap a
device's backend at runtime. The switch is our own logic, implemented inside
the custom **device-service** (`apps/device-service`, Go, EdgeX Device SDK —
the same one required for CAN, see section 5): per device, a config flag
stored in the Postgres Device Registry (never hardcoded) selects whether
that device's I/O goes to a **PhysicalTransport** or to the **Virtual Node
Runtime**. Because a custom device-service has to be written from scratch
for CAN anyway, the Virtual Node Runtime lives in the same Go process rather
than as a separate bridge/service (e.g. no EdgeX `device-rest` plus a
separate simulator app) — one process, one language, less overhead on
constrained hardware (Raspberry Pi).

CAN is the first bus, not the only one planned (RS485, Modbus, MQTT are all
named in `docs/PROJECT_MASTER-1.1.md`), so "physical" is not synonymous with
"CAN": `internal/transport` defines a `PhysicalTransport` interface
(`Name/Read/Write/Close`), and `internal/transport/can` is its first
implementation. `internal/driver` holds a `map[string]PhysicalTransport`
keyed by name and never talks to CAN directly - each future transport is a
new package satisfying the same interface, plus one line registering it in
`driver.Initialize`. A device's resource-to-wire addressing (CAN:
arbitration ID + byte offset; Modbus: register address; MQTT: topic; ...) is
fundamentally different per transport and is not unified beyond this
Read/Write boundary - each transport package owns its own mapping.

Postgres is the source of truth for both flags, but the device-service
itself has no Postgres dependency: whatever provisions a device into EdgeX
(Devices API, eventually) writes them onto the device's own EdgeX protocol
properties at that time -
`protocols.backend.mode: physical|virtual`, and, for physical devices,
`protocols.transport.type` (e.g. `"can"`) naming which registered
PhysicalTransport serves it, plus that transport's own properties in the
same block (CAN: `bus`). The device-service only ever reads these back off
the device it was just handed by the SDK — see
`apps/device-service/internal/driver/backend.go`.

This physical/virtual flag is **config-time only, not a live UI toggle**.
Changing it means updating the device's Device Registry entry and restarting
the device-service container — deliberately not a hot-swap. A device that is
physically active (e.g. a heater currently on) cannot be safely flipped to
virtual mid-operation without first forcing it to a known safe state, and
virtual-to-physical needs the same state resynced to real hardware first;
building that safety transition is real added complexity for a capability
nobody actually needs day-to-day (physical/virtual is a rare, deliberate
per-device commissioning decision, not something to flip repeatedly from the
UI). A cheap container restart is an acceptable cost for how rarely this
changes.

**Virtual Node Runtime**: the software model of a physical node/device, used
by the device-service when a device is switched to virtual. Written first,
before real hardware exists, and doubles as the reference implementation for
the STM32 firmware that eventually replaces it on real nodes — kept in Go
(not TypeScript) specifically so its logic stays close enough to embeddable C
to port cleanly. This supersedes the "Digital Twin" concept from
`docs/PROJECT_MASTER-1.1.md` section 8, which modeled simulation as an
alternate path around Device API/EdgeX rather than a backend swapped in below
EdgeX. PROJECT_MASTER is a versioned vision document and is not rewritten in
place for this kind of refinement — this file is the current source of truth
as the design evolves.

**Implementation status**: `apps/device-service` exists and works
end-to-end (`make edgex-up` registers it and its example device with
core-metadata; reads/writes round-trip through core-command). What's there
today is deliberately generic, since no real device type exists yet under
`devices/` (section 7):

- The Virtual Node Runtime (`internal/virtual`) is a plain get/set state
  store (`DeviceRuntime` interface, default `stateStore` implementation) —
  it echoes back whatever was last written or seeded, with no simulated
  dynamics. A concrete device type's own runtime (`devices/.../runtime/`)
  is meant to `Register` a richer implementation once one exists.
- The CAN transport (`internal/transport/can`, classic SocketCAN,
  Linux-only) is a real, working raw-frame send/receive primitive, but the
  mapping from a device resource to bytes on the bus (`mapping.go`) is
  intentionally minimal: one resource per arbitration ID, fixed byte
  offset/length, no bit-packed multi-signal frames (DBC-style). Revisit
  once a real CAN device profile needs more than that.
- The EdgeX SDK only calls `AddDevice` for a device new to metadata *this
  run* - a device that already existed from a previous run is silently
  reused without that callback firing again. Both backends must therefore
  be able to lazily initialize themselves from protocol properties alone,
  not rely on `AddDevice` having run: the CAN transport already does this
  (`ensureBus` opens lazily inside `Read`/`Write`); the Virtual Node
  Runtime's `EnsureDefault` is called the same way, from
  `HandleReadCommands`/`HandleWriteCommands` directly, not only from
  `AddDevice`. Found by actually restarting the service against an
  already-provisioned device, not by inspection - worth remembering when
  adding anything else that's set up "on add."
- `res/profiles/NexusEdge-Example-Virtual.yaml` and
  `res/devices/example-devices.yaml` are a smoke-test fixture, not a real
  device type — remove them once real device types are provisioned the
  intended way (via the Device Registry, not a static file baked into the
  service).

Devices API contains:
- a command adapter translating high-level calls (e.g.
  `devices.aquarium.maintenanceNode.coValve.on()`) into node-level commands;
- the Dual Devices Model (below);
- the **Model State Validator** — an in-process module, not a separate
  service (it needs the same Redis-backed state Devices API already holds,
  and a safety check must not cross a network hop) — that rejects any
  command that would put the physical system into a forbidden combined state
  (e.g. heating and cooling active at once) before it is dispatched.

**Dual Devices Model**: holds every device as a logical software twin that
handles all device API methods. It is distinct from the Virtual Node Runtime
above: Virtual Node Runtime replaces the physical device at the
device-service/EdgeX boundary, while the Dual Devices Model is Devices API's
own state machine and command gate sitting above EdgeX, used for every
device regardless of whether it is currently backed by real hardware or the
Virtual Node Runtime.

- **States** (per device or system-wide): `AUTO` (orchestrator controls
  everything), `SERVICE` (orchestrator controls, except devices manually
  overridden from the UI), `MANUAL` (UI controls directly).
- **Persistence**: all device state (both values arriving from physical
  devices and values set by the orchestrator or UI) lives in **Redis**.
  On a state change, the Dual Devices Model persists it first, then Device
  API syncs it to the device via EdgeX (physical or virtual backend alike).
  If sync fails, or a scheduled consistency check finds a mismatch, an error
  is raised.
- Each device tracks an `AUTO`/`MANUAL` flag plus corresponding Redis
  values. Methods: `setActive(bool)` (orchestrator-driven),
  `setManualActive(bool)` (UI-driven manual override), `getActive()`
  (returns `valueManual` while in manual mode). The orchestrator keeps
  updating `valueAuto` in the background even while a device is in manual
  mode, so that value takes over immediately once the device returns to
  automatic control.
- Whether a device is physical or virtual is a per-device property owned by
  the device-service layer (see above), not a Dual Devices Model mode — the
  previously documented `dev`/`prod` mode split is dropped in favor of this
  per-device backend flag, a cleaner fit now that EdgeX is always in the
  path.
- This model is implemented first and used as the reference for the STM32
  node firmware that will follow.

**Implementation status**: the Redis-backed state described above exists
now (`apps/api/src/dualDevicesModel.ts`), generalized to per
**(device, resource)** rather than strictly per-device — the rest of this
API already operates at resource granularity (`PUT
/devices/:id/resources/:resource`, the Model State Validator), and a
single-purpose device is just the case where it happens to have one
resource. Redis keys: `dvm:{deviceId}:{resource}:{mode,valueAuto,
valueManual}`.

- `PUT /devices/:id/resources/:resource` (the existing UI write path) is now
  `setManualActive`: any direct UI write both sets `valueManual` and
  switches that resource to `MANUAL` — a UI write *is* what "MANUAL" means.
- `PUT /devices/:id/resources/:resource/auto` is `setActive` — records
  `valueAuto`, but only reaches EdgeX while the resource is still `AUTO`.
  Dormant until section 10's "Temperature Control" process became the first
  real caller.
- `POST /devices/:id/resources/:resource/release` returns a resource from
  `MANUAL` to `AUTO`, immediately pushing whatever `valueAuto` the
  orchestrator kept computing in the background — verified live: set
  `Cooler` active via `/auto`, override it `MANUAL` via the plain `PUT`, call
  `/auto` again (confirmed it does *not* reach EdgeX while `MANUAL`), then
  `release` (confirmed the backgrounded `valueAuto` takes over immediately).
- `GET /system/mode` derives the aggregate `AUTO`/`SERVICE`/`MANUAL` from
  the *full* resource list in Postgres (not just whatever happens to have a
  Redis key) — a resource untouched in Redis is implicitly `AUTO`, and
  omitting it from the count would wrongly report `MANUAL` after a single
  override among many resources (a real bug caught during testing, not
  hypothetical).
- The Model State Validator (section above) now reads the *other* resource
  values it needs from this Redis state (via `resolveActiveValue`, falling
  back to a live EdgeX read only the first time a resource is ever touched,
  then caching it as the initial `valueAuto`) instead of live EdgeX reads on
  every write — resolves the simplification noted when the validator first
  shipped.
- Not yet done: no consistency-check job reconciling Redis against EdgeX's
  actual state (the "if a scheduled consistency check finds a mismatch, an
  error is raised" part above), and cross-device rules still aren't
  possible (a rule only ever compares resources on the same device).

**Read-only resources have no Dual Devices Model state at all** - not a
third mode, an *absent* one. A pure sensor (e.g. `Temperature` on the
smoke-test device, `Level` on the Light Regulator - section 7) is declared
`readOnly: true` in `devices.capabilities.resources` (Postgres); `GET
/devices/:id` then omits its `dualState` entry entirely rather than
defaulting to `AUTO` (a resource nothing ever commands isn't meaningfully
"automatic"), and `PUT /devices/:id/resources/:resource` /
`.../resources/:resource/auto` / `.../resources/:resource/release` all
reject it with 400 - there is no `MANUAL` to enter or `AUTO` to return to.
The EdgeX device profile for such a resource still declares it `RW`, not
`R` - EdgeX itself refuses writes to an `R` resource outright (405), which
would make it impossible to ever push a new reading through core-command at
all. Devices API is what actually enforces "no ordinary command surface for
this resource", via a separate dev-only path: `PUT
/devices/:id/resources/:resource/simulate` writes straight to EdgeX
core-command, bypassing the Dual Devices Model entirely (mirrors a physical
sensor producing a new value on its own), and publishes it exactly like a
controllable resource's write does (`dualDevicesModel.publishReading` -
`state:*` cache + `nexus.events`, see section 9), just without a
mode/valueAuto/valueManual - a plain `{value, timestamp, source}`.

## 7. Node & Device entities, `devices/` layout

**Entities**: `Node` and `Device` are both first-class, persisted in the
Postgres Device Registry.

- `Device` always registers in the Device Registry. `Device.nodeId` is a
  nullable FK: a device attached to a node (e.g. a sensor/actuator behind an
  STM32 node on the CAN bus) references it; a directly-connected device
  (e.g. a standalone USB sensor) has no node and declares its own
  bus/transport binding directly.
- `Node` is its own Registry row, not just a config grouping — identity,
  location, bus/transport binding, health and heartbeat belong to the node
  itself, independent of any single device behind it.

**`devices/` holds device-*type* definitions (design-time, versioned in
git), not device *instances*.** An instance is a Postgres Device Registry
row (id, location, current state) that references a type by name — same
split already implied by the `Type`/`Driver` fields in the Device Registry
example in `docs/PROJECT_MASTER-1.1.md` section 6.

Layout:

```
devices/
  nodes/
    <node-type>/                     e.g. aquarium-maintenance-node
      node.yaml                      node identity schema, bus binding, defaults
      firmware/                      shared STM32 project for the node (main, build);
                                      includes the per-device driver modules below
      devices/
        <device-type>/                e.g. co-valve
          contract.schema.ts          single capability/type contract (sensors,
                                       actuators, commands, units) — source of truth
                                       that the UI, Virtual Node Runtime and Devices
                                       API normalization are checked against
          edgex-device-profile.yaml   EdgeX Device Profile (resources/commands)
          safety.yaml                 this type's forbidden-state/interlock rules,
                                       consumed by the central Model State Validator
          runtime/                    Virtual Node Runtime module (Go), mirrors
                                       the STM32 behavior
          firmware/                   STM32 driver module for this device, included
                                       by the node's firmware/
          ui/
            control/                  production control/visualization component,
                                       integrated into the main UI
            simulator/                 dev-mode panel: shows internal state, allows
                                       overriding sensor values for testing
          config/
            default-state.yaml        initial virtual state + tunables (no hardcoded
                                       values)
          docs/
            README.md
            schematics/
          tests/
          CHANGELOG.md                 hardware/firmware revision history for this
                                       type, since it will drift from the original
                                       definition over time
  standalone/
    <device-type>/                    same internal layout, no parent node — its
                                       own bus binding lives in contract.schema.ts
```

A device type without a node (`standalone/`) still needs a `firmware/` of its
own (it has no node-level project to be included into). `devices/standalone/
light-regulator/` is the first real device type built to this layout (see
its Implementation status note below) - `runtime/` and `firmware/` are
deliberately absent there (nothing for either to add over the generic
Virtual Node Runtime yet, no hardware to target), everything else
(`contract.schema.ts`, `edgex-device-profile.yaml`, `safety.yaml`,
`config/default-state.yaml`, `docs/`, `tests/`, `ui/control`,
`ui/simulator`, `CHANGELOG.md`) is present and real.

**Implementation status**: the Postgres side of the Device Registry exists
now (`apps/api/migrations`, `node-pg-migrate`) - `nodes` and `devices`
tables, run automatically on every `apps/api` container start (idempotent;
node-pg-migrate tracks what's applied). `devices.capabilities.resources` is
an array of `{name, readOnly?, min?, max?, step?}` descriptors (not the
richer `contract.schema.ts` contract described above - that file exists per
device type today but nothing reads it across a process boundary yet, kept
in sync by hand), and `devices.edgex_device_name` is how a registry row
optionally links to an already-provisioned EdgeX device - there is still no
write-side provisioning flow (registering a Postgres row does not create
the EdgeX device, or vice versa; both the smoke-test example device and the
Light Regulator were wired up the same manual way - a static
`apps/device-service/res/devices/*.yaml` entry plus a Postgres seed
migration).

`apps/api` exposes this over HTTP: `GET /nodes`, `GET /nodes/:id` (registry
only), `GET /devices` (registry rows plus, for any with an
`edgex_device_name`, that device's live `operatingState`/`adminState` from
one core-metadata call), `GET /devices/:id` (registry row plus the live
value of every resource in `capabilities.resources`, read from EdgeX
core-command, and each *controllable* resource's Dual Devices Model state -
see the read-only-resources note in section 6), `PUT
/devices/:id/resources/:resource` (Model State Validator, then proxies the
write to EdgeX core-command; used by the UI's dev simulator page for
controllable/actuator resources), and `PUT
/devices/:id/resources/:resource/simulate` (the equivalent for `readOnly`
sensor resources - section 6).

EdgeX numeric readings need normalizing before they're usable: `apps/api/
src/edgex.ts` parses every Int*/Uint*/Float* reading's `value` (EdgeX always
sends these as strings, and Float32/64 always in scientific notation post-v2
- e.g. `"2.15e+01"` - there is no server-side config to change this anymore)
into a real JS number once, at the boundary, rather than leaking EdgeX's
wire format to every consumer (UI tables, the live WebSocket overlay, the
Light Regulator's slider). Found and fixed alongside a matching Go-side gap
in `apps/device-service`: `internal/driver/codec.go`'s `toInt64` only
accepted the native Go types a fresh YAML-seeded value arrives as (`int`,
`int64`, `float64`) - a resource written once and then read again arrives as
whatever type the Virtual Node Runtime's state store had already coerced it
to (`int32`/`uint32`/`uint64` for `Int32`/`Uint32` resources), which
`toInt64` rejected outright. Never surfaced before because no `Int32`/
`Uint32` resource existed to round-trip through it until the Light
Regulator's `Level` resource did.

**Model State Validator** (`apps/api/src/validator.ts`) now sits in front of
that write path. Rules are declared per device in
`devices.capabilities.forbidden` (Postgres) - `{ when: { resource, equals },
conflictsWith: { resource, equals } }` - and rejected writes get a `409`
with a reason. The example device (section 6/7's smoke-test fixture) was
extended with `Heater`/`Cooler` actuators and exactly the rule already used
as an example above ("heating and cooling must never be active at once"),
so the mechanism is real and tested, not just scaffolding. Two
simplifications to know about: rules only compare resources on the *same*
device (no cross-device rules - that needs the Redis-backed Dual Devices
Model state, which doesn't exist yet), and the validator re-reads the
*other* resource's current value straight from EdgeX core-command on every
write rather than a cached state store (extra HTTP round-trips per write;
fine at today's scale, revisit once Dual Devices Model persistence exists).

`apps/ui` has a first "Devices" section: Nodes list, Devices list, a generic
device detail (production-style, read-only), and a Dev Simulator page
(virtual devices only, shows and lets you override every resource). Both
detail views sort resources by name (a device's resource order was
otherwise whatever object-key order the API happened to return, which
visibly reshuffled on every live update) and dispatch to a device type's own
`ui/control`/`ui/simulator` component when one exists (`DEVICE_TYPE_CONTROLS`
/ `DEVICE_TYPE_SIMULATORS` maps, keyed by `device.type` then resource name -
today just the Light Regulator's `Level`), falling back to the generic
table row otherwise. The Dev Simulator's generic override column is instant
- no "Set" button - for `Bool` (checkbox) and any device-type-specific
control (e.g. the Light Regulator's slider, debounced 150ms so dragging
doesn't flood the API); a `NumericStepper` component (`apps/ui/src/views/
devices/NumericStepper.jsx`) is the +/- control for anything else (e.g.
`Temperature`) - no free-text input at all (an earlier version had one,
gated on matching an exact signed two-decimal pattern before "Set" would
even enable, which was confusing enough to remove entirely), each button
commits immediately. A quick click steps once; holding past 1 second
starts auto-repeating every 50ms until released (standard spinner-control
behavior), with a `window`-level `pointerup`/`pointercancel` listener as a
safety net so a release outside the button - a real drag off the edge, not
just a testing artifact - can't leave the repeat running forever. Callers
can optionally pass `min`/`max` to clamp the value (unbounded by default);
`ResourceMonitorPanel.jsx` passes `min={0} max={100}` since its thresholds
are percentages - a held repeat that hits the clamp stops itself rather
than continuing to fire identical commits for as long as the button stays
down. It also shows a device-wide "Auto value" column next to "Current value" (both
turn red on mismatch) for controllable resources, and renames "Release to
Auto" to "Auto", shown only while a resource is actually `MANUAL`.

`devices/` device-type components are imported straight into `apps/ui` from
outside its own package (`import ... from 'devices/standalone/light-
regulator/ui/simulator/LightRegulatorSimulator.jsx'`) via a `'devices/'`
Vite resolve alias (`apps/ui/vite.config.mjs`) pointing at the repo-root
`devices/` folder, which also needs `COPY devices devices` added to `apps/
ui/Dockerfile`'s build stage to be present in the build context at all.
Because `devices/` sits outside `apps/ui`'s own `node_modules` chain (pnpm's
strict, non-hoisted layout), plain Node resolution would never find `react`
from a file there - two more aliases pin bare `react`/`react/*` imports to
`apps/ui`'s own copy specifically so a device-type component shares the
same React instance as the app importing it, rather than failing to resolve
at all. These device-type components are intentionally "dumb": plain
controlled components (`value`/`min`/`max`/`onChange` props, Bootstrap
utility classes for styling since CoreUI's global CSS is already loaded
app-wide - no `@coreui/react` import, which would hit the same
cross-package resolution problem `react` does) with zero knowledge of HTTP -
`apps/ui` owns fetching and writing, they only render and report
interaction.

## 9. Messaging Service (Event Bus + realtime UI push)

The "message service between physical devices, the orchestrator and the UI"
named in the original project brief. Reuses **RabbitMQ** (already deployed,
already named "Event Bus" in section 3) rather than adding a second broker -
`apps/api` publishes, `apps/messaging-gateway` is today's only consumer,
fanning events out to UI WebSocket clients.

**Exchange and routing keys**: one topic exchange, `nexus.events`, durable.
Routing key shape: `<domain>.<entityId>.<resource>.<eventType>` — today only
`device.<deviceId>.<resource>.updated` exists (published by
`dualDevicesModel.ts` — see below). `node.<id>.heartbeat` and
`system.mode.changed` are reserved shapes for later, not implemented yet.

**Envelope** (JSON body of every message): `{ domain, entityId, resource,
value, mode, valueAuto, valueManual, timestamp, source }` — one flat shape
for every event type, deliberately not modeled per-event-type since nothing
so far needs it.

**Publish side** (`apps/api/src/messaging.ts` + `dualDevicesModel.ts`):
every `setActive`/`setManualActive`/`release` call ends by publishing the
resource's new effective state and refreshing a Redis cache key,
`state:{deviceId}:{resource}` → `{ value, mode, valueAuto, valueManual,
updatedAt, source }`. This is a **separate key from `dvm:*`** (section 6) —
`state:*` has **no TTL**: it is last-known-value state, valid until the next
write, not a liveness/heartbeat signal. There is no heartbeat producer
anywhere yet (`apps/device-service` doesn't emit one), so a TTL-based
"device went silent" signal is future work, not implemented — do not assume
`state:*` expiring means anything yet. Publishing is best-effort: a
RabbitMQ/Redis hiccup on this path is logged and swallowed, never allowed to
fail the device write it rides along with.

**Consume + fan-out side** (`apps/messaging-gateway`): a deliberately thin
service — no Postgres, no EdgeX client, only `ioredis` (read-only, for the
snapshot) and the RabbitMQ client. Binds **one** exclusive, auto-delete
queue to `nexus.events` with `#` (everything) — per-client filtering by
routing-key pattern happens in-process (`topicMatch.ts`, reimplementing
RabbitMQ's own `*`/`#` wildcard semantics) rather than one RabbitMQ binding
per WebSocket client, so the exchange/queue topology never changes as UI
clients connect and disconnect. `GET /ws?topics=<comma-separated patterns>`
(default `#` if omitted): on connect, immediately sends `{type: "snapshot",
events: [{routingKey, event}, ...]}` from the `state:*` cache filtered to
the requested patterns, then streams `{type: "event", routingKey, event}`
for every subsequent bus message that matches — each `event` is always the
same envelope shape (section above) whether it came from the snapshot or
the live stream, so a client only needs one code path to handle both. Both
`apps/api` and `apps/messaging-gateway` use
`amqp-connection-manager` (not bare `amqplib`) specifically for its
auto-reconnect — verified live by restarting the `rabbitmq` container under
a connected gateway and API: both logged "disconnected" then "connected"
within seconds, no restart of either Node process needed, and a write made
right after reconnection still published and arrived over the socket
correctly.

**Access model**: deliberately not built yet. Every service authenticates to
RabbitMQ as the single existing user (`RABBITMQ_DEFAULT_USER`/`_PASS`) — no
per-role RabbitMQ permissions, no per-user topic ACL. This is fine while the
platform has no multi-user auth at all (JWT/Casbin is still an unstarted,
separate item from `docs/PROJECT_MASTER-1.1.md` section 16); revisit
RabbitMQ vhost permissions and gateway-side topic ACLs once that layer
exists, rather than building access control here first.

**Considered and deliberately not chosen**: an MQTT retained-message
approach (redundant with the `state:*` cache above), NATS (RabbitMQ is
already deployed — switching now is pure churn), Centrifugo (a real
"batteries-included" realtime gateway with channels/presence/JWT built in,
but it solves a multi-user auth problem the platform doesn't have yet — the
thin custom gateway above is far cheaper for what's actually needed today;
Centrifugo remains a candidate if/when real multi-user auth lands), and
Socket.IO (an unneeded protocol layer over plain WebSocket).

**Implementation status / known simplifications**:
- No heartbeat producer exists anywhere — `node.*.heartbeat` is a reserved
  routing-key shape, not a real event yet.
- `apps/api` is the only publisher. Nothing bridges EdgeX's own southbound
  device events into `nexus.events` yet, so a device's state only reaches
  the bus when something calls the Devices API's write path — a physical
  device changing state on its own (e.g. a sensor reading drifting, not
  commanded) does not yet produce a live event. EdgeX core-data can publish
  new readings to a configurable message bus (Redis pub/sub, MQTT, or NATS)
  as a northbound feature — bridging that into `nexus.events` via
  `apps/api` is the natural next step, but needs live verification against
  the actual Palau no-secty configuration before relying on it; not done,
  not assumed to work.
- `apps/ui` now consumes this WebSocket: `src/api/liveSocket.js` is one
  shared, lazily-opened, auto-reconnecting connection to the relative `/ws`
  path (nginx reverse-proxies it to `messaging-gateway`, same reasoning as
  the existing `/api/*` proxy — see `nginx.conf.template` and
  `vite.config.mjs` for the local-dev mirror). Its `subscribeToLiveEvents`
  listener receives `{routingKey, event}` for every message (snapshot
  entries and live pushes alike, same shape). `src/api/useLiveDevice.js`
  exposes `useDeviceLiveState(deviceId)` (per-resource `{value, mode,
  valueAuto, valueManual, timestamp}` overlay) and
  `useLiveConnectionStatus()` (for the small `LiveBadge` shown on the Device
  Detail, Dev Simulator, and Live Events pages). Device Detail/Dev Simulator
  patch live value/mode over whatever the initial REST `GET /devices/:id`
  returned, without touching the Dev Simulator's in-progress draft inputs.
  `views/devices/LiveEvents.jsx` (`/live-events`) is a raw, unfiltered feed
  of every message the socket receives, newest first, capped at a **fixed
  constant** (`MAX_EVENTS = 200` in that file) — a placeholder until a real
  filter/limit control is built; don't read that number as a considered
  design choice. Verified end-to-end through the exact browser path
  (`ws://localhost:8080/ws` via the UI's nginx, not hitting
  `messaging-gateway` directly) and the production UI bundle builds cleanly
  with this code — **not** verified in an actual browser window (no
  browser tool available in this environment); the user should confirm the
  Live badge and value updates render correctly on first real use.
- Every service shares one RabbitMQ user (see Access model above) — fine at
  today's single-tenant, no-auth stage.

## 10. Processes / Orchestration

`apps/orchestrator`'s first real logic — it was an empty `/health`-only
shell until this. A **process** is an automation unit: `START/PAUSE/STOP`
or `ON/OFF` (whichever apply — see `actions` below), optionally grouped for
the UI, optionally "permanent" (no actions at all — always running,
AGENTS.md's original "critical processes that can't be stopped").

**Where things live** (same split as devices — Postgres is the design-time
registry, Redis is live state that changes every tick):

- `processes` table (`apps/api/migrations`): `id, name, group_id, type
  (controllable|permanent), kind, actions text[], device_id, config jsonb`.
  `group_id` references `process_groups` (id, name) - a real, independently
  manageable entity, not a free-text column (section 19). `kind` is a
  discriminator (e.g. `temperature-control`,
  `temperature-monitor`) selecting which control-loop function
  `apps/orchestrator` runs for it — not a generic plugin system yet (that's
  future work per section 4's "plugin lifecycle"), just a fixed
  `Record<kind, runner>` map (`apps/orchestrator/src/index.ts`).
  `config` is loose jsonb like `devices.capabilities` — shape depends on
  `kind`; today just `{min, max}` for the temperature-\* kinds.
- Live state — **Redis**, in `apps/api/src/processRegistry.ts` (mirrors
  `dualDevicesModel.ts` in spirit, though its own storage shape changed in
  section 24): one hash per process, `process:{id}:public`, fields
  `status`/`critical`/`warning`/`metrics`/`messages` (`status` meaningless
  and never set for a `permanent` process). `setStatus`/`setCritical` are
  no-ops (no Redis write, no broadcast trigger) when the value already
  matches — the orchestrator calls both every tick regardless of whether
  anything changed, and a 1-second tick loop must not flood the fleet-wide
  broadcast (section 24) with identical triggers forever. This state no
  longer publishes onto `nexus.events` at all (section 24 pulled the whole
  `process` domain off that exchange) — see section 24 for where it goes
  instead and why.
- `apps/orchestrator` never touches Postgres/Redis/EdgeX directly — only
  the Devices API (`apps/orchestrator/src/apiClient.ts`), same principle as
  "does not talk to hardware protocols directly" (section 4), extended to
  storage too. Its own `config.ts` reaches `apps/api` via the docker-compose
  *service name* `api` (hardcoded, like `apps/ui/nginx.conf.template`
  already does) — not `API_HOST`, which is `api`'s own bind address
  (`0.0.0.0`) and isn't reachable from another container.

**Devices API surface** (`apps/api/src/routes/processes.ts`): `GET
/processes`, `GET /processes/:id` (registry row + live `status`/`critical`
merged in, like `GET /devices` does for EdgeX state), `PATCH
/processes/:id/config` (rejects `max < min`), `POST /processes/:id/action`
(only `ON`/`OFF` implemented — `START`/`PAUSE`/`STOP` are named in the
general concept but nothing uses them yet), `POST /processes/:id/critical`
(orchestrator-only — there is no "make critical" button in the UI).

**The two seeded processes** (`apps/api/migrations/
..._seed-temperature-control-processes.ts`), both against
`example-virtual-sensor-01`, group "Temperature Control":

1. **Temperature Control** (`controllable`, `ON`/`OFF`) — every tick while
   `on`: reads `Temperature`, writes `Cooler`/`Heater` via `PUT
   /devices/:id/resources/:resource/auto` (`setActive` — the *first* real
   caller of that endpoint, dormant since the Dual Devices Model shipped).
   `Cooler = temperature > max`, `Heater = temperature < min`, written
   every tick unconditionally (matches `/auto`'s own documented intent —
   "the orchestrator keeps updating `valueAuto` in the background" — this
   is genuinely that background computation, not something to debounce).
   While `off`: does nothing further, **except once, exactly on the
   on→off transition** (tracked in an in-memory `Map` in
   `apps/orchestrator/src/processes/temperatureControl.ts` — resets on
   restart, which is fine, nothing here needs to survive one), where it
   forces both actuators off — confirmed live: pushed temperature above
   `max` (`Cooler` turned on), flipped the process `OFF` (`Cooler` forced
   back to `false`), flipped back `ON`.
2. **Temperature Safety Monitor** (`permanent`, no actions) — independent
   of process 1, deliberately configured with a **wider** min/max (`15/28`
   vs. process 1's `18/25` — confirmed: independent values by design, a
   permanent monitor may have wider critical margins than the controller it
   watches, not a duplicate of the same numbers) — every tick: reads
   `Temperature`/`Cooler`/`Heater` directly (the live EdgeX-reported values,
   not the Dual Devices Model's computed "active" value — the point is
   catching *actual* device-reported divergence), raises `critical` if
   temperature is outside its own range **or** `Cooler`/`Heater` are both
   `true` at once. That last check deliberately duplicates what the Model
   State Validator already forbids on the write path (section 6) — this is
   intentional defense-in-depth (a stuck relay or a bypass of the API
   wouldn't go through the validator at all), not redundant dead code.
   `critical` is raised for **this process's own id only** and clears
   itself automatically the instant conditions normalize (confirmed by
   design, not a latch requiring acknowledgment — a deliberate choice, not
   an oversight). Also emits `error`-type WEM entries for the same two
   conditions (`temperature_out_of_range`, `cooler_heater_conflict` -
   section 22), so they show up in the UI's message row, not just the
   boolean flag.
   **Previously** this also force-propagated its own `critical` onto the
   `temperature-control` process it watches, via `config.linkedProcessIds`
   (`[1, 2]` — both itself and the controllable process, so both rows
   highlighted). Removed — flagged by the user as a kludge from before WEM
   existed that didn't fit the intended architecture (a permanent
   monitor's own failure forcing an unrelated controllable process into
   critical as a side effect). `apps/api/migrations/
   ..._remove-temperature-monitor-linked-process-ids.ts` strips the now-
   unused key from the already-seeded row's config.

**UI** (`apps/ui/src/views/processes/ProcessesList.jsx`, nav "Orchestration
› Processes"): group/type filters, a table row per process — name, group,
status badge, right-aligned action buttons per `actions`, then the expand
chevron last (everything interactive pressed to the row's right edge,
chevron after actions, not before) — expanding a per-`kind` detail panel
below the row: `TemperatureProcessPanel.jsx`, shared by both temperature-\*
kinds since they look identical (`NumericStepper` — the same component Dev
Simulator uses for `Temperature` — for `min`/`max` writing to the process's
own config, not a device resource; current temperature in large type; big
Cooler/Heater indicators, colored only while active). Live `status`/
`critical` overlay via `useProcessLiveState`
(`apps/ui/src/api/useLiveProcess.js`) — same one-shared-subscription,
keyed-by-id pattern as `useDeviceLiveState` (section 9), reused rather than
reinvented.

A `critical` row (and its expanded panel row) gets `<CTableRow
color="danger">` — **not** a `className="bg-danger-subtle"`, which was
tried first and looked like nothing was happening at all (backend `critical`
was confirmed correct via direct API calls the whole time - this was purely
a rendering bug). CoreUI/Bootstrap tables resolve a row's background through
a `--bs-table-bg` CSS custom property that its own striping/hover machinery
also writes to at the `<td>` level; a plain `background-color` utility
class on the `<tr>` gets masked by that instead of showing through.
`CTableRow`'s own `color` prop (→ `table-danger`) is what actually sets
that variable correctly - worth remembering for any future
row-highlighting, not just this one. Action buttons also have a fixed
width (`ACTION_BUTTON_STYLE`) and track *which* action is in flight
(`busyAction`, not a shared boolean) - a button swapping its label for a
`CSpinner` used to change that button's own width, which changed the
Actions column's width for every row the moment any one row's button went
busy, reading as the whole table jumping.

**Not done / known limitations**:
- No heartbeat — the general process concept describes one, but neither
  seeded process needed it to be useful yet; still the same unimplemented
  gap noted for devices in section 9.
- `temperature-monitor`'s out-of-range check silently treats an unreadable
  `Temperature` (`NaN`) as "not critical" rather than failing safe — a real
  safety system should probably do the opposite; not fixed, called out
  explicitly rather than left quiet.
- `START`/`PAUSE`/`STOP` actions don't exist —
  `RUNNERS`/`IMPLEMENTED_ACTIONS` are small fixed maps, not a plugin system.
  A third `kind`, `resource-monitor`, now exists alongside the two
  temperature-\* ones — see section 21.
- No automated tests — verified live (docker compose, both directions:
  temperature swung out of range and back, process turned `OFF` mid-cooling
  and back `ON`), same testing posture as the rest of this codebase.

## 11. UI list tables: pagination, filtering and shared helpers

A universal, reusable pagination/filter toolkit for `apps/ui` table views,
modeled on the *architecture* (not the code — different stack: `fetch` not
axios, CoreUI free not `-pro`) of an existing reference project
(`sevenstime-backoffice`) the user pointed at for this purpose.

**Client-side, not server-side — deliberate, confirmed choice.** That
reference project paginates server-side (Symfony/Doctrine, `page`/`limit` →
`{items, total}`, a near-duplicate `COUNT` query per list). This platform's
list volumes are tens of rows (devices/nodes/processes on a single
Raspberry Pi), not thousands, and every list endpoint already returns its
full result set with no query params at all. Changing `GET /nodes`,
`/devices`, `/processes` (and a future `/users` endpoint, once UI
authorization — the next roadmap step — adds one) to `page`/`limit` +
`{items, total}` just to serve a row count that's currently
2–3 would be scope with no present payoff. Chosen instead: the API keeps
returning full arrays; a small client-side toolkit paginates/filters
in-memory. Revisit only if a list's real row count grows into the
hundreds+.

**Files** (`apps/ui/src/`):
- `hooks/useDebouncedValue.js` — generic `useDebouncedValue(value, delayMs)`.
  Standalone (not tied to a text input) so any rapidly-changing state can be
  debounced in one line instead of a page-local `useEffect`+`setTimeout`
  pair (which is what the reference project does inline in every view —
  factored out here instead).
- `hooks/usePagination.js` — `usePagination(items, { pageSize })` → `{ page,
  pageSize, totalItems, totalPages, pageItems, setPage, setPageSize }`.
  Operates on an already-filtered array; never touches filtering itself.
  `page` is clamped against the live `totalPages` on every read (not stored
  pre-clamped), so a filter/search change that shrinks the result set can
  never strand the view on a page number that no longer exists — no
  "reset page to 1 on filter change" boilerplate needed in the caller,
  unlike the reference project's manual `setCurrentPage(1)` in every filter
  handler.
- `components/table/TablePagination.jsx` — controlled, presentational:
  page-size `<select>`, "showing X–Y of Z" info, numbered `CPagination`
  controls (max 5 visible page numbers, sliding window). Owns no state —
  pair it with `usePagination` above. Splits the reference project's
  `PaginatorInfo`/`PaginatorControls` pair into one component since nothing
  here needs them separately.
- `components/table/TableSearchInput.jsx` — a `CFormInput` wired straight to
  `useDebouncedValue`; the raw keystroke value stays local (so typing never
  lags) and only the debounced value reaches the caller's `onSearch`.
- `utils/format.js` — `formatDateTime(iso)`, `formatRelativeTime(iso)` (`"5
  minutes ago"`, `"never"` for a nullish timestamp), `isStale(iso,
  thresholdMs)`. Pure functions, no API/state — display helpers for the
  `created_at`/`updated_at`/`last_heartbeat_at` columns Postgres already
  returns on every node/device row but that nothing rendered before this.
  `isStale` is intentionally unused for now — a staleness threshold would be
  a config value (AGENTS.md section 1: no hardcoded config in code), and
  there is still no heartbeat producer to make one meaningful (same gap
  noted in sections 9/10); wire it up once both exist instead of inventing a
  threshold now.

**Wiring a new list page** (the whole point — "universal, minimal glue"):
```jsx
const filtered = items.filter(/* page-specific predicate(s) */)
const { page, pageSize, pageItems, totalItems, setPage, setPageSize } = usePagination(filtered)
// render pageItems instead of filtered/items in the table body, then:
<TablePagination page={page} pageSize={pageSize} totalItems={totalItems}
  onPageChange={setPage} onPageSizeChange={setPageSize} />
```
Filter *predicates* stay page-specific (a text search, a dropdown, or both —
`ProcessesList` keeps its existing group/type `CFormSelect`s and adds a name
search on top) since what's filterable genuinely differs per table; only
the pagination mechanics and the search-input debouncing are shared.

**Already wired**: `views/devices/NodesList.jsx` (search across
name/type/location, `TablePagination`, new "Last heartbeat" column via
`formatRelativeTime`), `views/devices/DevicesList.jsx` (search across
name/type, `TablePagination`), `views/processes/ProcessesList.jsx` (kept its
group/type dropdowns, added a name search box, `TablePagination` — the
pagination hook is called unconditionally before the loading/error early
returns, since hooks can't follow a conditional `return`).

**Helper categories considered and deliberately NOT built yet** (surveyed
from the reference project so this list — not the code — could be reused;
described here precisely so a future session doesn't rebuild what already
exists above, or build these before they're actually needed):
- **Query-string builder** (`buildQueryString(params)`, dropping
  empty/null values) — the reference project gets this for free from axios;
  nothing in this codebase issues a GET with query params yet (pagination
  above is client-side). Build it the day a server-side query param
  actually appears, not before.
- **Global toast helper** (a `window.toast.{success,error,info}` API backed
  by one mounted component, decoupling "trigger a toast" from "render a
  toast") — the reference project uses this to toast from non-component
  code (API error handlers). Every toast in this codebase today is a
  page-local `CToast` (`ProcessesList.jsx`, `DevSimulator.jsx`) triggered
  from a component that's already rendering; no non-component call site
  exists yet to justify the indirection.
- **Currency/number formatting** — the reference project formats USD/token
  balances; there is no money/balance concept anywhere in this platform.
  Skip entirely unless one appears.
- **Permissions/roles helper** (a generic `roles()` hook reading many
  possible permissions, an `AccessDeniedBlock`) — UI authorization (section
  13) landed with only one meaningful role (`admin`) and a single inline
  check (`user.roles.includes('admin')`) everywhere it's needed
  (`AppSidebar.jsx`, `AppHeaderDropdown.jsx`) — a generic multi-permission
  hook would be solving a problem that doesn't exist yet.
- **`objectToFormData` / generic file-upload helper** — avatar upload
  (section 13) turned out to need only a single `FormData` + one `<input
  type="file">` call site (`UserForm.jsx`), not a reusable helper; revisit if
  a second upload flow appears.
- **`fetchErrorMessage`-style error normalization** — already effectively
  covered by `apps/ui/src/api/client.js`'s `request()`, which extracts
  `body.reason ?? body.error` from a non-2xx JSON response; no need to add a
  second, separately-named helper that does the same thing.

## 13. UI authorization (login, users, roles, avatars)

Login-gates the admin panel itself (AGENTS.md's original "Ми додаємо
наступні кроки" roadmap, step 2). **Deliberately NOT done here**: per-endpoint
API authorization — `/nodes`, `/devices`, `/processes`, `/system/*` remain
completely open, unauthenticated, exactly as before. Only two route groups
are actually gated: `/auth/*` and `/users/*`. That's a separate, much larger
future task (would need to decide what an EdgeX-adjacent device-control API
protected by roles even looks like) — not something this step should block
on or half-implement.

**Session mechanism** — one JWT, httpOnly cookie, no refresh token:
- `POST /auth/login` verifies `bcryptjs` against `users.password_hash`,
  signs a JWT (`{sub, username, roles}`, `@fastify/jwt`, `JWT_EXPIRES_IN`
  env, default `12h`) and sets it as an httpOnly, `SameSite=Strict` cookie
  (`nexus_edge_session`) — never readable from JS, so `apps/ui` never
  handles the token directly, only the `user` object the login/`/auth/me`
  response bodies return.
- No separate refresh token / Redis-backed session store — a expired
  session just means logging in again. Simpler, and there's no multi-device
  revocation requirement yet to justify the extra moving part.
- `requireAuth`/`requireAdmin` (`apps/api/src/auth.ts`) are the only two
  route guards in the codebase. `userRoutes` (`apps/api/src/routes/
  users.ts`) applies `requireAdmin` via a single `app.addHook("preHandler",
  requireAdmin)` at the top of the plugin — every `/users/*` route needs it,
  a per-route list would just be repetition. `authRoutes` only guards
  `GET /auth/me` (login/logout must work unauthenticated, obviously).
- `apps/ui/src/components/AuthGate.jsx` wraps the whole authenticated shell
  (the `*` route in `App.jsx`, around `DefaultLayout`) — calls `GET
  /auth/me` once on mount to recover a session across a page refresh (the
  cookie already rides along), redirects to `/login` on any failure.
  `views/pages/login/Login.jsx` no longer has a "Sign up" link/`/register`
  route — this is an admin-managed user model, not self-registration, and
  the old CoreUI demo `Register.jsx` page was deleted (dead code that would
  have actively contradicted this design if left in).

**Users** (`apps/api/migrations/..._create-users-table.ts`,
`routes/users.ts`):
- `users.roles` is a Postgres `text[]`, not a comma-joined string — the
  schema supports more than one role per user even though `admin` is the
  only role that means anything today (`ALLOWED_ROLES` in `routes/users.ts`
  is the single source of truth for what's valid; extending it later is a
  code change, not a migration).
- Two seeded, protected accounts (`..._seed-default-users.ts`, passwords
  from `ADMIN_DEFAULT_PASSWORD`/`SYSTEM_DEFAULT_PASSWORD` env, hashed at
  migration time — same "change-me placeholder in `.env.example`"
  convention as every other credential here, not a stronger generated-secret
  scheme, for consistency): `admin` (role `admin`, can never be deleted or
  deactivated) and `system` (no roles, can never be deleted, *can* be
  deactivated). `PROTECTED_USERNAMES`/`NON_DEACTIVATABLE_USERNAMES` in
  `routes/users.ts` are the one place this is encoded — every response
  includes computed `deletable`/`deactivatable` booleans so `apps/ui` only
  ever disables buttons based on what the server already decided, never
  re-implements the rule.
- Passwords hashed with `bcryptjs` (pure JS, not native `bcrypt`/`argon2`) —
  deliberately, to avoid a native build toolchain (python3/make/g++) in the
  Docker build stage and per-architecture prebuilt binaries, given this
  platform's explicit Raspberry Pi target (section 1).

**Avatars**: `POST /users/:id/avatar` (`@fastify/multipart`, PNG/JPEG/WebP
only, size-limited by `AVATAR_MAX_SIZE_BYTES`) writes to
`config.uploads.avatarsDir` (`AVATAR_UPLOAD_DIR` env, a dedicated
`api-avatars` Docker volume — not baked into the image, survives rebuilds)
under a random filename (`${userId}-${uuid}.ext}`), never the client-supplied
name. Served back via `@fastify/static` at `/uploads/avatars/*` on the API
itself — reachable from the browser at `/api/uploads/avatars/*` through the
existing nginx `/api/` proxy (`apps/ui/nginx.conf.template`), no new nginx
location needed. Deleting a user or replacing their avatar unlinks the old
file best-effort (a missing file on disk never blocks the DB write).

**apps/ui**: session `user` lives in the existing generic Redux store
(`store.js`, `dispatch({type:'set', user})`) — the same pattern already used
for `sidebarShow`/`theme`, not a new Context/state library. `AppSidebar.jsx`
filters nav items flagged `adminOnly: true` (just the new Settings → Users
entry, `_nav.jsx`) against `user.roles` — cosmetic only, the real gate is the
server's 403; hiding the link just avoids showing signed-in non-admins a
link that would fail. `UsersList.jsx`/`UserForm.jsx` reuse the pagination/
search toolkit from section 11 (proof it's actually "minimal glue" per-page,
not just descriptive).

## 15. CoreUI demo scaffolding removed

The CoreUI Free React Admin Template `apps/ui` was bootstrapped from ships
with a full showcase of every component it offers (Base, Buttons, Forms,
Charts, Icons, Notifications, Widgets, Theme/Colors+Typography) plus an
"Extras" nav section (Login/404/500 shortcut links, an external link to
CoreUI's own docs site). None of it was ever real - it existed to demo the
template, not this platform - and none of it was reachable from anywhere a
real user would go. All of it is now deleted:

- `views/{base,buttons,forms,charts,icons,notifications,theme,widgets}/`
  (every file), `views/dashboard/MainChart.jsx`, and the `Docs*` support
  components (`components/DocsComponents.jsx`/`DocsExample.jsx`/
  `DocsIcons.jsx`/`DocsLink.jsx`) — confirmed via full-repo grep that nothing
  under `devices/`, `processes/`, `users/`, or `layout/` referenced any of
  it before deleting.
- Every corresponding `routes.js`/`_nav.jsx` entry, and the dead
  `AppHeader.jsx` cruft that came with them: a top-nav "Users"/"Settings"
  pair of `href="#"` links (never wired to the real `/users` route or
  anything else) and three icon-only `href="#"` nav items (bell/list/
  envelope) that looked like notification shortcuts but went nowhere -
  confirmed via the same grep pass, not assumed.
- Now-unused npm dependencies: `chart.js`, `@coreui/chartjs`,
  `@coreui/react-chartjs` (only the deleted chart/widget/dashboard demo
  files used them), `classnames` (only `Colors.jsx` and the old
  `Dashboard.jsx` used it). `prop-types` and `simplebar-react` stay -
  `AppSidebarNav.jsx` (real layout code) uses both. `src/scss/examples.scss`
  (CoreUI's own "remove in your application" comment) and its `App.jsx`
  import, the `@coreui/chartjs` `@use` line in `style.scss`, and the 9
  now-orphaned `assets/images/avatars/*.jpg` files are gone too.
- Dropping the Icons/Flags/Brands/chart.js demo chunks took the production
  build from several multi-megabyte chunks (`Flags` alone was ~3.1 MB
  minified) down to well under 1 MB total - a direct, measured win for the
  Raspberry Pi target (section 1), not just tidiness.

**What stayed, deliberately, as real (not demo) pages**:
- `views/dashboard/Dashboard.jsx` — emptied to a single placeholder card
  ("Nothing here yet"), not deleted: there's no cross-cutting "system
  overview" concept designed yet (see Devices/Orchestration for what
  actually exists), and inventing one just to fill this page would be
  scope no one asked for.
- A new `views/docs/Docs.jsx` — same empty-placeholder pattern, replacing
  the sidebar's external link to CoreUI's own doc site. This platform's
  actual documentation lives in the repo (`README.md`, this file,
  `docs/PROJECT_MASTER-1.1.md`), not behind a UI page - stays empty until
  there's a real reason to render docs in-app.
- `views/pages/login/`, `page404/`, `page500/` — real functional pages
  (section 13), wired directly in `App.jsx` outside `routes.js`/`_nav.jsx`.
  The sidebar shortcut *links* to `/login`/`/404`/`/500` (the old "Extras >
  Pages" group) were removed as demo-only navigation - none of these are
  pages a user manually navigates to from a menu in the finished product -
  but the pages/routes themselves are untouched and still reachable exactly
  as before (redirect-on-logout for `/login`, direct URL for the error
  pages).

Final sidebar: Dashboard, Devices (Nodes/Devices/Dev Simulator/Live
Events), Orchestration (Processes), Settings (Users, admin-only), Docs.

## 17. Shared table toolkit: expandable rows + persisted page state

Two more generic, registration-style pieces alongside the pagination
toolkit (section 11), built against `views/processes/ProcessesList.jsx`
and wired into that page only so far - the next page that wants either
adopts the hook/component directly, no copy-pasting.

**Expandable rows** (`hooks/useExpandableRows.js` +
`components/table/ExpandToggleButton.jsx` / `ExpandAllToggleButton.jsx`):
the hook owns no state itself - it's pure `isExpanded`/`toggleOne`/
`allExpanded`/`toggleAll` logic over an `expandedIds` array + setter the
caller already has (from `usePersistedState` below, or a plain
`useState([])` if a page doesn't want persistence). `toggleAll`/
`allExpanded` take the relevant id list as an argument rather than binding
it once, since "which rows are visible right now" is page-specific (e.g.
only the current page of a paginated table) and changes every render.
`ExpandAllToggleButton` is the one-line header counterpart: give it
`ids`/`expandedIds`/`setExpandedIds` and it renders nothing when there's
nothing expandable, otherwise the same `ExpandToggleButton` used per-row.

**Persisted page state** (`hooks/usePersistedState.js` +
`utils/cookies.js`): filters, search text, page size, and which rows are
expanded are the kind of thing someone sets up while actually using a
page and expects to survive a refresh - not durable data, so a cookie, not
Postgres. `usePersistedState(cookieName, defaults)` treats `defaults` as a
**registration**, not just a fallback: its keys are exactly what gets
read from / written to the cookie (as one JSON blob), its values are what
a first visit (or a field a stale cookie doesn't have yet) starts from. A
field removed from `defaults` later stops being read even if an old
cookie still has it - the schema decides what exists, not the cookie.
Returns `[state, setState]` where `setState(partial)` shallow-merges and
re-persists the whole object, same ergonomics as the app's Redux
`dispatch({type:'set', ...})` pattern elsewhere.

`usePagination` (section 11) still owns `page`/`pageSize` itself and knows
nothing about persistence - it gained one optional `onPageSizeChange`
callback, fired whenever `setPageSize` runs, so a page can mirror the new
size into its own persisted state without the pagination hook needing to
care where (or whether) that goes. The current page number is
deliberately **not** persisted - reopening a page and landing on page 4 of
what's now a different, unfiltered list would be more confusing than
useful; page size is a stable preference, current position isn't.

`ProcessesList.jsx`'s registration:
```js
const PERSISTED_DEFAULTS = {
  groupFilter: '', typeFilter: '', search: '', pageSize: 10, expandedIds: [],
}
```

## 19. Process groups + generic manage-named-list popup + filter-row convention

**Process groups are a real entity now**, not a free-text column
(`apps/api/migrations/..._create-process-groups-table.ts`): `process_groups
(id, name unique)`, `processes.group_id` references it (`ON DELETE
RESTRICT` as a DB-level backstop). The old `processes.group_name` text
column is gone entirely - `GET /processes` joins `process_groups` for
display (`routes/processes.ts`'s `PROCESS_SELECT`). Renaming a group used
to mean find/replace across every process row sharing that string; now
it's one `UPDATE` on one row. An empty group can now exist and be listed,
which a name derived from `SELECT DISTINCT group_name FROM processes`
could never show.

`routes/processGroups.ts` (no auth gate, same as every other
devices/nodes/processes route - section 13): `GET/POST/PATCH/DELETE
/process-groups`. Every group response carries a computed `deletable`
(false if any process still references it) - the one place that check is
encoded, mirroring the `users` route's `deletable`/`deactivatable` pattern
(section 13): the UI only ever disables a button based on what the server
already decided, never re-implements the rule. `DELETE` checks and returns
a friendly `400 {"error": "group is not empty"}` before ever reaching the
FK constraint.

**`components/ManageNamedListModal.jsx`** - the generic popup asked for so
this isn't rebuilt per entity: add-one / inline-rename-one /
delete-one-if-`deletable` over a `{id, name, deletable}` list, everything
domain-specific (title, labels, the three async callbacks) passed as
props. Groups is its first and only consumer today - the next similar
"manage a small named list" popup reuses this instead of a copy-paste.

**Filter-row convention**: every list page's filter row reserves its
last, non-`xs="auto"` `CCol` (`className="d-flex justify-content-end"`) as
a right-aligned block for page-level action buttons - filters flow left
to right, actions live in that one flex-end column. This is a layout
convention (plain `CRow`/`CCol`), not a component - there's nothing to
abstract beyond "put your buttons in this column," so nothing was built
beyond documenting it here.

(Superseded specifics, section 23: the reset-filters button on the
Processes page moved from `ProcessesList.jsx`'s own single top-level
filter row into each tab's own `ProcessesTable`-owned filter row - since
the tabs rework gave every tab its own filter combination and its own
`groupFilter`/`typeFilter`/`statusFilter`/`search` state, "one reset next
to one shared filter row" no longer applied - and its icon is `cilFilterX`,
not `cilReload`. The convention above (right-aligned trailing `CCol`)
still holds, just per-tab now instead of page-level.)

One wrinkle worth remembering: `TableSearchInput` (section 11)
deliberately owns its typing state after mount and never resyncs from a
changed `value` prop, so `setPageState({search: ''})` alone doesn't clear
what's actually showing in the box. `ProcessesList.jsx` forces a remount
via a `key` bumped on every reset (`key={searchResetToken}`) instead of
touching `TableSearchInput`'s debounce logic.

## 20. Running the stack

```
cp .env.example .env      # adjust values
make up                   # platform only: postgres, redis, rabbitmq, orchestrator, api, ui
make edgex-up             # EdgeX Foundry core stack only
make up-all                # both together
make logs
make down / make down-all
```

No service is expected to run outside Docker. See `Makefile` for all
available targets.

Postgres is reachable from the host (not just from other containers) at
`127.0.0.1:${POSTGRES_HOST_PORT}` (default `55432`, e.g. `psql -h
127.0.0.1 -p 55432 -U $POSTGRES_USER -d $POSTGRES_DB`) - a separate .env
variable from `POSTGRES_PORT`, which is what containers use to reach each
other over the docker network and stays `5432` regardless. Deliberately
non-standard so it doesn't collide with a Postgres already running
natively on the host's own `5432`. Redis/RabbitMQ don't have an
equivalent - their host-side `ports:` mappings in `docker-compose.yml`
still reuse `REDIS_PORT`/`RABBITMQ_PORT` directly, unchanged.

## 21. Resource Monitor (`resource-monitor` process kind)

A permanent host-health process (`apps/orchestrator/src/processes/
resourceMonitor.ts`) — CPU/RAM/disk load, seeded by `apps/api/migrations/
..._seed-resource-monitor-process.ts` into a new "System" group, no
`device_id` (it watches the orchestrator's own host, not an EdgeX device —
`device_id` was already nullable for exactly this kind of case). Same
"reuse the existing `critical` concept" approach as `temperature-monitor`
(section 10) rather than inventing a parallel one.

**Library choice**: no dependency at all, not even `systeminformation`
(the original suggestion) — Node built-ins cover everything needed:
`os.cpus()` (CPU%, via the idle/total tick delta between two consecutive
1-second samples — `os.cpus()` reports cumulative ticks since boot, not a
point-in-time load, so a single sample can't give a percentage),
`os.totalmem()`/`os.freemem()` (RAM%), and `fs.statfsSync("/")` (disk%,
stable in Node since 18.15 — same `used/(used+bavail)` formula `df` itself
uses for its Use% column). `systeminformation` bundles many unrelated
subsystems (GPU, bluetooth, USB, battery, etc.) for a project whose stated
target is Raspberry-Pi minimalism — not worth the weight for three numbers
Node already exposes directly.

**Container vs. host accuracy** (a real open question, not silently
assumed): CPU/RAM read from `/proc` inside the orchestrator container
reflect the real *host* values, and disk usage from the container's own
root filesystem tracks the host disk's real free space — both **only**
because `docker-compose.yml` sets no cgroup cpu/mem limit and no storage
quota on the `orchestrator` service. This holds for this project's
single-host/Raspberry-Pi deployment target; it would not hold unmodified in
a setup where the orchestrator's container itself is resource-constrained
(a host-filesystem bind-mount and cgroup-aware reads would be needed then,
not attempted here).

**Where things live** (same split as section 10): thresholds are in
`processes.config` jsonb — Postgres, design-time, writable via the same
generic `PATCH /processes/:id/config` every other kind's config already
uses (the handler merges whatever fields a request body actually contains,
rather than hardcoding `min`/`max`). Two tiers per metric: `cpuMax`/
`ramMax`/`diskMax` (error — red row, the original `critical` concept) and
`cpuWarnMax`/`ramWarnMax`/`diskWarnMax` (warning — yellow row, a second,
less severe Redis flag added alongside `critical`). **A threshold of 0 (or
omitted) disables that specific check** — per metric, independently, not
an all-or-nothing gate on the whole tick the way temperature-monitor's
`min`/`max` are.

Live readings **are** pushed through the WebSocket feed, same as `status`/
`critical`/`warning` — though the mechanism underneath changed in section
24 (Redis-cached fleet snapshot + Pub/Sub notify to apps/messaging-gateway,
not a `nexus.events` publish per field). `metrics` is still the one field
in that snapshot refreshed *unconditionally* every tick rather than only on
an actual change (`status`/`critical`/`warning` all stay no-ops when the
value already matches - see their own doc comments). Metrics don't have
that luxury: the whole point is a live-updating reading, and an unchanged
disk% still being current every tick is *correct* here, not a bug to guard
against - though per section 24, a metrics update on its own is still only
timer-cadence, not an urgent out-of-band trigger. This wasn't the original
design - the first version had the UI poll `GET /processes/:id` once a
second instead, deliberately avoiding the bus for exactly the "flood it"
reason above. That reasoning didn't hold up: the orchestrator already
calls `setMetrics` exactly once per tick regardless, so "publish once a
second" comes for free from that existing cadence, and the polling
approach left this one feed on a completely different transport from
every other kind of live process state for no real benefit - reworked
during this session once that inconsistency was pointed out. `GET
/processes`/`GET /processes/:id` still merge the latest reading in as
`metrics: {cpu, ram, disk}` too, purely as the initial snapshot a page
load starts from before its first live event arrives (same role status/
critical/warning's REST fields already played) - `apps/ui/src/api/
client.js` no longer has a `getProcess` method, since nothing polls
anymore.

**Warning tier**: `processRegistry.getWarning`/`setWarning` and `POST
/processes/:id/warning` mirror `getCritical`/`setCritical`/`POST
/processes/:id/critical` exactly (same no-op-unless-changed, same urgent
fleet-broadcast trigger on an actual flip - section 24). The orchestrator computes both
every tick and error always wins: `warning` is only ever raised when
`critical` is false, so a metric already past its error max never leaves
the row flickering between red and yellow — it's one or the other.
Sending and consuming actual warning notifications (e.g. an email/Slack
alert) is intentionally out of scope for now — this only wires up the
threshold, the state, and the row color.

**Tick throttling**: CPU/RAM are read every 1-second tick like every other
`kind`; disk is checked at most once a minute (module-scope cache in
`resourceMonitor.ts`, keyed on nothing but time — there's one host, not one
per process) since disk usage barely moves and `statfsSync` gains nothing
from being called every second.

**UI** (`apps/ui/src/views/processes/ResourceMonitorPanel.jsx`): three
rows, not three processes — CPU/RAM/Disk, each with its live % in large
type, a "Warning Max%" `NumericStepper` and, right after it, an "Error
Max%" one (step 1, same component `TemperatureProcessPanel` uses, clamped
`min={0} max={100}` here since these are percentages - see section 7's
`NumericStepper` entry for the hold-to-repeat mechanism itself) for that
metric's own two thresholds. The row itself (`ProcessesList.jsx`) picks
`danger`/red over `warning`/yellow over nothing, same precedence as the
orchestrator's own critical-wins-over-warning logic — confirmed live by
dropping `cpuMax` to 1% (row turns red), then raising it back above the
current reading and lowering `cpuWarnMax` instead (row turns yellow).
Independently, **inside** the panel, each metric's own current-value text
is colored `text-danger-emphasis`/`text-warning-emphasis` (Bootstrap/CoreUI
utility classes, computed client-side from that metric's own value against
its own thresholds - not from the row-level `critical`/`warning` flags)
whenever that specific metric, not necessarily the process as a whole, is
the one past its threshold - these are deliberately the emphasis variants,
not plain `text-danger`/`text-warning`, since they're designed to stay
readable against the row's own tinted `danger`/`warning` background rather
than assuming a plain one.

**1-minute levels chart** (`ResourceLevelsChart.jsx`, sitting to the right
of the three rows): a rolling 60-second CPU/RAM/Disk line chart, one hand-
rolled inline SVG, not a charting dependency - same "Node built-ins/no
extra package" call already made for the metrics themselves. There is no
server-side history endpoint; the chart is fed purely from the panel's own
`useProcessLiveState` subscription (the same live feed that already drives
`metrics` for the three rows), buffered client-side into a `history` array
capped at `MAX_SAMPLES` (60) samples and reset to empty every time the row
is re-expanded - "the
last minute of what this browser tab has actually observed since opening
the panel," not a true historical record. The newest sample always pins to
the chart's right edge; with fewer than 60 samples the line only occupies
the right portion of the width and fills in leftward, rather than
stretching a handful of points across the full width and looking
misleadingly zoomed out. Disk's line is visibly "steppy" (flat, then a
jump) rather than smooth like CPU/RAM - an honest reflection of disk only
being checked once a minute server-side, not a chart bug.

Layout: the chart stretches to the full height of the three metric rows
and all the remaining width (parent width minus the rows' own columns) via
a flex row (`d-flex align-items-stretch`) with the rows in a plain auto-
width column and the chart in a `flex-grow-1` one. The chart's own root is
`position: absolute; inset: 0` against that `flex-grow-1` column (itself
`position: relative`), **not** `height: 100%` in normal flow - the
`flex-grow-1` column has no in-flow content of its own to give it a
height, so a plain percentage height there is circular (this chart would
be the only reason that column has any size at all) and the SVG falls back
to its own viewBox aspect ratio applied to the correctly-resolved width,
which rendered as a huge square blowing out past the whole table (caught
live, screenshotted, and fixed during this session - worth remembering for
any future "fill a flex sibling's height" component: absolute-position the
sized content instead of nesting percentage heights through it).

**Known limitation**: the first tick after an orchestrator restart has no
previous CPU sample to diff against (see above) — that one tick reports
`cpu: 0` and skips both the critical and warning checks entirely rather
than risk a false reading off a meaningless first sample.

## 22. Logging + WEM (Warnings/Errors/Messages)

First slice of a larger, explicitly-scoped-down logging/notifications
system - three new Postgres tables and their services, wired into real
producers, plus one new UI row. Deliberately **not** built yet (per the
user's own phased request): a Messages Configuration page (group
management, the warning/error 1-4 level→period scale), a process's own
"which message groups does this send to" editor, the `messenger` process
kind that would actually deliver WEM to devices/users/email/SMS, and any
browsing/filtering UI for the two append-only log tables below - those
are named as future work, not started.

**`device_command_logs`** (`apps/api/src/deviceCommandLog.ts`) - one row
per call to any of the Devices API's four mutating endpoints
(`routes/devices.ts`: write/auto/release/simulate), logged as an
*attempt*, not gated on success - a rejected command (forbidden state,
EdgeX 4xx) is often the more interesting thing to audit, so this runs
before those checks, not after. `source` is always `"api"` today, same
simplification `dualDevicesModel.ts` itself already makes (it doesn't
distinguish a human/UI-driven call from an orchestrator-driven one either
- there's no per-request actor identity to attach, since device routes
have no auth middleware - AGENTS.md section 13's "deliberately NOT done"
still holds, not revisited here).

**`sensor_reading_logs`** (`apps/api/src/sensorReadingLog.ts`) - one row
per readOnly (sensor) resource value, hooked inside
`dualDevicesModel.publishReading` itself rather than at the `/simulate`
route that's its only caller today - so a future real EdgeX push/poll
path (none exists yet - section 6/9 already note this) logs here too
automatically. No filtering yet, logs unconditionally ("хардкодимо,
пропускаємо все" per the request) - a real deployment's write volume on
constrained flash storage is a known, explicitly deferred concern (the
user's own framing: logs "can in the future be stored externally, e.g. on
lightweight microcomputers with write limits, or be turned off").

Both of the above are **append-only** and best-effort - modeled on
`messaging.ts`'s own `publish()` (a logging failure must never break the
real operation it's observing), each wraps its own insert in try/catch and
just warns on failure rather than propagating.

**`process_messages`** (`apps/api/src/processMessages.ts`) - WEM proper,
layered alongside a process's existing `critical`/`warning` Redis flags
(section 10/21), not a replacement. Unlike the two logs above, a row here
has a lifecycle, not just a timestamp:

- `code` is a stable machine identifier for *which* condition this is
  (`"cpu_error"`, not the human-readable text) - what dedup actually
  compares. `level` is currently just a placeholder integer (`1` for
  every entry resource-monitor produces) - there's no Messages
  Configuration page yet to give the 1-4 scale from the original request
  real meaning.
- `hidden` is a single **global** flag (confirmed with the user - not
  per-user; whoever dismisses a message, it's dismissed for everyone).
- `resolved_at IS NULL` means still active. For `type` `warning`/`error`,
  set automatically once the condition that raised it clears. For type
  `message`, **never** set automatically - a message is a one-shot
  notification ("backup completed at 03:00"), not a condition that can
  later become false the way a threshold breach can; it only leaves the
  active list via a user dismissing it (`setHidden`). This distinction
  was missed in the first pass and corrected mid-session once flagged.
- A partial unique index, `(process_id, type, code) WHERE resolved_at IS
  NULL`, enforces "at most one active row per condition" at the DB level
  too, not just in application code.

**`syncActiveMessages(processId, type, entries, source)`** - the shared
dedup/reconciliation mechanism the original request asked for ("step 4").
A process calls this with the *complete current set* of codes it
considers active for one `type`, not just newly-appearing ones (mirrors
how `resourceMonitor.ts` already recomputes cpu/ram/disk fully every
tick, not incrementally). Diffs that against the DB inside one
transaction: a new code is INSERTed; a still-active code has its
`level`/`text` refreshed in place *only if they actually changed* (a live
reading like "CPU at 90%" becoming "CPU at 95%" doesn't count as a new
occurrence); a code no longer present gets `resolved_at` set (types
`warning`/`error` only, per above). Publishes the process's complete
active list (`field: "messages"`, `ProcessEventEnvelope` -
`messaging.ts`) exactly once per call, and only if something in the diff
actually changed - same no-redundant-publish principle as
`setCritical`/`setWarning`, just computed over a set instead of a single
boolean, since a boolean only has two states to compare and this has to
diff two code sets. `setHidden` (UI-driven dismiss) publishes the same
event after toggling, so every viewer's row updates immediately.

**Real producer**: `resourceMonitor.ts` (section 21) now calls
`apiClient.syncMessages` twice per tick - once for `"error"`, once for
`"warning"` - one entry per metric that's currently past its respective
threshold, independent of the row-level `critical`/`warning` flags (so
CPU and RAM can each carry their own message simultaneously). This was
the minimal real wiring needed to make the UI row below actually
demonstrable end-to-end rather than dead code - confirmed live: CPU
pushed over its error threshold produced `cpu_error`, RAM over its warn
threshold produced `ram_warning` at the same time, both sorted
error-first; restoring a threshold auto-resolved and removed its message;
dismissing one while the condition was still active correctly hid only
that one row (verified via direct DB/log inspection, not just the UI, to
rule out a false read from browser-automation testing noise).
`temperatureMonitor.ts` (section 10) is the second real producer, added
once the user noticed Temperature Control never showed any WEM entries
despite raising `critical` - it wasn't wired to `syncMessages` at all
originally, only the boolean flag.

**Badges**: `apps/ui/src/utils/wem.js`'s `wemBadgeClass(type)` is the one
shared helper for how WEM-classified text gets colored, used by both
`WemRow.jsx` (the message list) and `ResourceMonitorPanel.jsx` (each
metric's own value, badged when its zone is `warning`/`error`, plain when
`normal`) - a solid/bright background (`bg-danger`/`bg-warning`/
`bg-success`, not the pale `-subtle` variant used for row highlighting
elsewhere) with `rounded-pill` corners, always paired with plain black
text rather than a matching-tinted one - the bright background is already
the signal, and `ResourceMonitorPanel`'s metric values no longer change
their *text* color by zone at all (an earlier version did, via
`text-danger-emphasis`/`text-warning-emphasis` - replaced per explicit
user direction: text is always black, the background is what changes).

**Row order**: Messages are no longer their own table row at all - they
render *inside* the detail panel's cell, after the panel's own content
(`ProcessesList.jsx`'s `ProcessRow`: plain row → [detail panel + `WemRow`]
as one cell, only when expanded). Earlier versions gave Messages their own
row, first below the panel, then above it, independent of expand/collapse
- both left the collapsed table jumping up/down as conditions came and
went, since a row could appear/disappear at any time regardless of user
action. Nesting `WemRow` inside the already-expandable panel cell means
messages only ever show once the user has deliberately opened that
process, so the collapsed table's layout is stable no matter what's
happening underneath. This also simplified the border logic: the plain
row drops its bottom border exactly when `expanded && Panel`, and the
panel row (when it renders) is unconditionally last, no more conditional
border-dropping needed on `WemRow` itself.

**Dismiss only applies to `type: "message"`** - clarified after the first
pass had every type's `.btn-close` wired up the same way. An error/warning
is tied to a live condition; it's visible for exactly as long as that
condition holds and leaves the active list on its own once resolved (via
`syncActiveMessages`), with **no** user-facing way to hide it early. Only
a one-shot `message` (no ongoing condition to clear) leaves the active
list via the user reading and dismissing it. Enforced twice, not just
once:
- **UI** (`WemRow.jsx`) only renders the `.btn-close` when
  `message.type === "message"` - error/warning lines render with no
  dismiss control at all.
- **API** (`processMessages.setHidden`) independently rejects
  `hidden: true` for any other type before touching the row, throwing
  `MessageNotDismissableError` - caught in `routes/processes.ts`'s PATCH
  handler and turned into a 400 - so a stray/non-UI call can't hide an
  active error/warning either, same defense-in-depth reasoning as
  `temperature-monitor`'s independent safety check.

**API surface** (`routes/processes.ts`): `POST /processes/:id/messages`
(orchestrator-only, body `{ type, entries }`) and `PATCH
/process-messages/:messageId` (UI-driven, body `{ hidden }` - no
`:id/messages` nesting check, a message's own id is already globally
unique; 400 if `hidden: true` targets a non-`message` entry, per above).
`GET /processes`/`GET /processes/:id` merge in `messages:
ProcessMessage[]` (active, non-hidden, pre-sorted) via
`listActiveMessages`, same "REST gives the initial snapshot, the live
feed keeps it current" role `metrics`/`critical`/`warning` already play.
`listActiveMessages`'s sort tiebreaks on `created_at` via `new Date(...)`,
not `.localeCompare` - `pg` hands back `timestamptz` columns as `Date`
objects, not strings, so the original `.localeCompare` only surfaced once
two active entries actually tied on type+level (single-message testing
never exercises that path) and then threw, 500-ing `GET /processes`
entirely.

**UI** (`apps/ui/src/views/processes/WemRow.jsx`): a plain content block
(not a table row - see "Row order" above) rendered as the last thing
inside a process's own detail panel cell, right after `<Panel />`, only
when that process is both expanded and has a panel for its kind
(`KIND_PANELS`) - a process kind with no panel currently has no way to
show messages either, but every real WEM producer today (`resource-
monitor`, `temperature-monitor`) does have one. Each message is its own
line, numbered continuously (not renumbered per type) in already-server-
sorted order, colored per its own `type` via the shared `wemBadgeClass`
helper (see "Badges" above) - not per the row as a whole, since one
process can have errors, warnings, and messages active concurrently. A
small `.btn-close`, only on `message` lines (see above), calls `PATCH
/process-messages/:id`.

**Disk-specific `message` notice** (`resourceMonitor.ts`): on top of the
regular per-metric error/warning entries every metric gets, Disk
additionally gets a `message` (`disk_warning_notice`/`disk_error_notice`)
whenever it's over its warning/error max - CPU and RAM deliberately don't
get this, it's Disk-only by request, not a fourth generic per-metric
loop. Sent via its own `syncMessages(process.id, "message", entries,
"when-hidden")` call, same tick as the existing error/warning calls.

That trailing `"when-hidden"` is `autoResolve` (`syncActiveMessages`'s
5th param, added after this notice first shipped, type
`"always" | "when-hidden" | "never"`) - **not** the default for `type:
"message"` (`"never"`), and deliberately overridden here. Went through
two bugs before landing on this three-way design; both real user reports
against the same feature:

1. First version left `autoResolve` at its `"never"` default. A dismissed
   notice then stayed hidden forever: `syncActiveMessages` had no signal
   it ever needed resolving, so a later re-trigger just re-found the same
   still-hidden row by its unchanging code and rewrote its text in place
   - reported as "closed it, then raised and lowered the limits again, no
   new message ever showed back up."
2. Fixed by adding a plain boolean `autoResolve: true`, resolving the row
   unconditionally whenever Disk dropped back under threshold - **whether
   or not the user had dismissed it yet**. That broke rule 1 the other
   way: a message the user hadn't closed would vanish on its own the
   instant Disk normalized, reported as "the green message disappears
   together with the warning condition, but it should only disappear when
   someone hides it."

The fix for both at once is conditioning resolution on `hidden`, not
applying it unconditionally: `"when-hidden"` only resolves a row on a
missing code if that row is *already* dismissed (`hidden = true`) -
that's the case that needs a fresh row to appear when the condition later
re-triggers. A row still showing (`hidden = false`) is left alone even
after its code goes missing, so it keeps satisfying "message: visible
until the user closes it" (rule 1) with no time limit tied to the
underlying reading. Once the user does dismiss it, the *next* tick where
the code is still missing (or already was) resolves it then, via the same
codepath - `resolved_at` and `hidden` are independent columns throughout,
dismissing never touches the former and resolving never touches the
latter. A later re-trigger finds no still-active row for that code (the
old one now has `resolved_at` set, outside the partial unique index's
`WHERE resolved_at IS NULL` scope) and INSERTs a fresh one - undismissed,
back in the active list.

`"always"` (the default for warning/error) resolves unconditionally,
matching their original behavior exactly - they're never dismissable in
the first place (`hidden` is always `false` for them), so `"always"` and
`"when-hidden"` would coincide for that type anyway; `"always"` is kept
explicit rather than derived, since it's the simpler/original semantics
and doesn't depend on this notice's later fixes. `"never"` remains the
default for `type: "message"` overall, correct for a true one-shot
notification that's sent once and never re-asserted (e.g. the still-
hypothetical "backup completed at 03:00") - such a producer has no
"missing from this call" signal to act on in the first place, since it
only ever calls once.

## 23. Processes page: tabs, Dashboard, and the three group entities

The single flat Processes table (section 10/21/22) became a tabbed
workspace: **Dashboard**, **All**, one dynamic tab per **Tab Group**
(admin-ordered, see below), **Controllable**, **Permanent**, **Settings**
- in that order, `apps/ui/src/views/processes/ProcessesList.jsx`'s
`tabDefs`. Built on CoreUI 5.13's newer fully-controlled tabs API
(`CTabs`/`CTabList`/`CTab`), first use of it anywhere in this app (the
only prior tab-shaped UI was the sidebar's `CNavItem`/`CNavLink`, a
different component family). Deliberately **not** `CTabContent`/
`CTabPanel` for the bodies - reading CoreUI's source shows `CTabPanel`
never unmounts an inactive panel (only toggles CSS classes), which would
keep every tab's `ProcessesTable` - and every row inside it, each
independently subscribed to the live WebSocket via `useProcessLiveState`
- mounted simultaneously across every tab a process appears in.
`ProcessesList` instead renders whichever tab's body is active via a
plain conditional (`renderActiveTab()`), so only the current tab is ever
mounted.

### Three group entities, not one

The page ended up needing three different "named group of processes"
concepts, easy to conflate (an earlier pass genuinely did, see below) but
serving unrelated purposes:

- **Process Groups** (`process_groups`, `routes/processGroups.ts`,
  unchanged since section 10/17) - the *technical* system a process
  belongs to (heating, lighting, security, aquarium...). Drives the
  existing Group column and its filter dropdown. Alphabetical only.
- **Tab Groups** (`tab_groups` + `process_tab_groups`,
  `routes/tabGroups.ts`) - an *operator's own curated workspace*:
  whichever processes one operator wants to watch, regardless of which
  Process Group they're technically in (an operator isn't necessarily
  responsible for one whole technical system - they may need to watch
  processes across several, for business-logic reasons unrelated to the
  technical grouping). Each Tab Group is one dynamic page tab, in
  admin-controlled `position` order - unlike Process Groups, order here
  is a real UX concern since it's literally tab order.
- **Message Groups** (`message_groups` + `process_message_groups`,
  `routes/messageGroups.ts`) - WEM *notification routing* (section 22's
  original "which message groups does this process send to" concept,
  finally built): which recipient eventually gets which processes'
  warnings/errors/messages. Deliberately decoupled from Process Groups
  for the same reason as Tab Groups (an operator's notification needs
  don't align with the technical grouping) - and *also* decoupled from
  Tab Groups, since "which tab shows this process" and "who gets notified
  about this process" are independent questions with independent
  answers. No `position` - nothing here drives an ordered UI. The actual
  delivery mechanism (who/what a "recipient" is, how a message physically
  reaches them) is still deferred, same as the still-unbuilt `messenger`
  process kind named in section 22 - this table is what a future
  delivery mechanism would read from, not something that does anything
  on its own yet.

Tab Groups and Message Groups are structurally near-identical (admin-
named list, many-to-many with processes via a join table, `ON DELETE
CASCADE` both directions, freely deletable any time - no "must be empty"
rule like Process Groups has) and both assigned per-process via the same
popup (see below) - the only structural difference is Tab Groups'
`position` column and its `PATCH /tab-groups/reorder` endpoint (validates
the submitted id set exactly matches what currently exists, 400s on any
mismatch, then reassigns `position = index` per entry in one
transaction) - Message Groups has no reorder endpoint at all.

**History**: the first pass built only one entity, named "Message
Groups" in code, that did both Tab Groups' job (driving ordered dynamic
tabs) and was described as the notification-routing concept - conflating
the two. Flagged by the user with a concrete example of why they diverge
(an operator watching processes across multiple Process Groups for
business reasons, who should only receive notifications relevant to
*their* work, not their whole technical system) - the fix was a rename
(the tab-driving entity became "Tab Groups", freeing up "Message Groups"
for a fresh, genuinely separate entity with the same name) rather than a
new concept bolted onto the old one.

### Filter bar

Every listing tab renders through the shared `ProcessesTable`
(`apps/ui/src/views/processes/ProcessesTable.jsx`, extracted from the
original single-tab `ProcessesList.jsx` so Dashboard/All/each Tab
Group/Controllable/Permanent share one implementation rather than
duplicating table+pagination+expand-row logic six-plus times). Which
filter controls a tab shows is **not** a single on/off switch - a
`filters` prop (`{ search?, group?, type?, status? }`) lets a tab declare
any combination, and `ProcessesList.jsx`'s `TAB_FILTERS` map is the
single place that decides the combination per tab key (any key not
listed, i.e. every dynamic `tg:*` Tab Group tab, falls back to
`TAB_FILTERS.all`) - changing a tab's filter bar later is a one-line edit
there, no other file involved. Today: All/Controllable/Permanent/every
Tab Group tab get Process Group + Type + Status + Search; Dashboard gets
Search only (its own `FILTERS` constant in `DashboardTab.jsx`); Settings
has no listing at all. Type is intentionally left interactive (not
disabled/locked) on Controllable/Permanent even though it's redundant
there with the tab's own base scope - picking the "wrong" type just
surfaces the existing empty-state message, which is simpler than
special-casing those two tabs out of an otherwise uniform component.
Status (`active`/`inactive`) filters on `p.status`, the same field the
Status column badges off - a process with no `status` at all (permanent/
system kinds, which show the plain "Running" badge instead of ON/OFF) is
always `active` here, since it has no off state to be `inactive` in; only
an explicit `status === 'off'` counts as inactive.

The filter row itself always renders, even when the current combination
matches zero processes - `filtered.length === 0` only swaps out the
table+pagination for the `emptyMessage` `CAlert` below the row, not the
row itself. An earlier version returned the alert *instead of* the whole
component body, which took the filter controls down with it the moment a
filter produced an empty result (e.g. a Tab Group tab's own "no processes
in this tab group yet" state, or any filter combination with no matches),
leaving no visible way to change or clear whatever filter just caused
that. The reset-filters `IconButton` (`cilFilterX`) lives inside this
same filter `CRow`, in a trailing right-aligned `CCol` - not next to the
`CTabList` above it - so it always sits next to the controls it actually
clears; `hasActiveFilters` (whether to show it at all) is computed
locally in `ProcessesTable` from whichever of `search`/`groupFilter`/
`typeFilter`/`statusFilter` that tab's own `filters` flags make relevant,
and `onResetFilters` is supplied per tab key by `ProcessesList.jsx`'s
`handleResetFilters(tabKey)`.

Persisted per-tab (`usePersistedState('nexusedge.processesPage', ...)` -
a *new*, independent registration, not a repurposing of the older
`'nexusedge.processes'` key from section 17, which is left alone/generic
for whichever future page wants its own): `perTab[tabKey] = { search,
pageSize, groupFilter, typeFilter }`. `expandedIds` is the one thing kept
global rather than per-tab - the same process/detail-panel regardless of
which tab it's viewed from. Note `usePersistedState` only merges
top-level cookie keys (its own doc comment), not nested ones - a `perTab`
entry for a tab that didn't exist yet when the cookie was last written
needs its own `?? DEFAULT_TAB_STATE` fallback at read time, which
`ProcessesList.jsx`'s `tabState()` helper provides.

### Dashboard tab

Every process that has *ever* had an active WEM entry since last
cleared - `processes.dashboard_flagged_at` (nullable `timestamptz`), set
once by `processMessages.maybeFlagForDashboard(processId)`: a single
`UPDATE ... WHERE dashboard_flagged_at IS NULL AND EXISTS (SELECT 1 FROM
process_messages WHERE process_id = $1 AND resolved_at IS NULL)`, called
unconditionally at the end of every `syncActiveMessages` (cheap, one
indexed `EXISTS`; idempotent via the `IS NULL` guard, safe to call
whether or not this particular sync actually changed anything). Stays
flagged - shown on Dashboard - until a user clicks the row's X, which
only succeeds (`DELETE /processes/:id/dashboard-flag`, 400 otherwise)
once the process is genuinely back to zero active entries
(`processMessages.hasActiveEntries`, checked server-side, not just a
client-side disabled state). Empty Dashboard renders a plain green "OK"
`CAlert`, nothing to page through.

`hasActiveWem` (in `GET /processes`' `withLiveState`, and now also in
`ProcessFleetEntry` - see section 24) is **not** derived from the same
response's `messages` array - `listActiveMessages` (used for `messages`)
excludes `hidden` entries for *display* purposes, but the Dashboard
flag/unflag rule cares about the underlying condition regardless of
whether a user has hidden its notification, so it's a separate,
unfiltered `hasActiveEntries` check.

**Bug, found live (2026-07):** this used to be REST-only (read once at
`DashboardTab.jsx` mount, never refreshed), on the theory that staleness
could only ever make the X *more* conservative and never incorrectly
enabled. That reasoning missed the actual failure mode: a process whose
active WEM genuinely resolved *while the page stayed open* kept a stale
`true` forever, permanently disabling the button at the DOM level - no
click ever reached the handler, reported live as "the button doesn't
react to clicks at all" (easy to miss, since a disabled icon button
doesn't look dramatically different from an enabled one at a glance).
Fixed by pushing `hasActiveWem` through the same live broadcast as
`dashboardFlaggedAt` (section 24's `ProcessFleetEntry`) and reading it in
`DashboardTab.jsx` the identical way: `liveEntry ? liveEntry.hasActiveWem
: process.hasActiveWem` - not `??`, same reasoning as `dashboardFlaggedAt`
above. Compounding this, clearing the flag (`DELETE
.../dashboard-flag`) previously relied on the next periodic/urgent
broadcast tick to inform the UI at all, so a successful removal could
still visibly linger on Dashboard for up to a full broadcast interval -
the route now calls `broadcastForced("dashboard-flag-cleared")` right
after the flag-clearing `UPDATE`, so the row disappears the instant the
click succeeds.

### Settings tab

Four cards (`apps/ui/src/views/processes/SettingsTab.jsx`), each backed
by the shared `apps/ui/src/components/NamedListManager.jsx` (extracted
from the old `ManageNamedListModal.jsx` popup - AGENTS.md history: that
popup's "Manage groups" button lived in the main toolbar; both are gone
now that the form lives in this tab instead, and nothing else needed the
modal wrapper, so it was deleted rather than kept unused):

- **Process Groups** - unchanged CRUD, moved from the old popup.
- **Tab Groups** - `orderable`, with up/down arrow buttons per row
  (`NamedListManager`'s own `move()`: swaps the clicked row with its
  neighbor in the *current displayed order* and resends the complete new
  id array to `PATCH /tab-groups/reorder`, matching that endpoint's
  "whole list, not a single move" contract).
- **Message Groups** - same CRUD shape, not `orderable`.
- **Message Levels** - `MessageLevelsForm.jsx`, a fixed 8-row matrix
  (`message_levels` table: `type` × `level` 1-4, seeded by migration, no
  add/remove - only `mode`/`period_deciseconds` per row are ever edited).
  `mode` is one of `off`/`constant`/`shortBeep`/`longBeep`; period
  (tenths of a second) is a plain `CFormInput type="number"`, not the
  `NumericStepper` used elsewhere for click-and-hold device values -
  `NumericStepper`'s own `format()` is hardcoded to `.toFixed(2)`, which
  would misrender an integer decisecond count as `"5.00"`, and its whole
  press-and-hold-repeat machinery is irrelevant to a rarely-touched
  settings field. Config-storage only for now - nothing reads these
  values to actually play a sound yet, same "not built yet" status as the
  Message Groups delivery mechanism above.

### Per-process Settings popup

`apps/ui/src/views/processes/ProcessSettingsModal.jsx`, opened by a new,
unconditional first action button on every row (`cilSettings`, white/
outline like every other `IconButton` default - rendered *before* the
per-kind action buttons so it's never hidden behind `process.actions`
being empty for permanent processes). Two independent `CFormCheck`
sections - Tab Groups and Message Groups - each its own fetch-on-open
(`GET /processes/:id/tab-groups` / `.../message-groups`, just the id
array) and its own locally-edited `Set`, saved together on one Save
click (`Promise.all([setProcessTabGroups, setProcessMessageGroups])`,
both `PUT`s replacing the complete membership set rather than an
incremental add/remove). The sections mount only while the modal is
actually open (`{visible && process && (...)}` inside `CModalBody`, not
just CoreUI's own `visible`-styling) - otherwise every row's hidden popup
would eagerly fetch membership for a process nobody has opened Settings
for; mounting fresh each open also means each section's own `loading`
state (initialized `true`) is correct on every reopen with no separate
reset plumbing needed. `CModal` itself stays unconditionally rendered
(only `visible` toggles) so CoreUI's own open/close transition still
works - conditionally unmounting the whole modal component would skip
that.

### Row action buttons

`ProcessRow`'s trailing cell renders every per-row control - the per-kind
action buttons (ON/OFF etc.), the Settings gear, an optional caller-
supplied `extraAction` (Dashboard's remove-X), and the expand toggle - as
one `d-flex justify-content-end align-items-center gap-1 flex-nowrap`
row, left to right in that order (i.e. right to left: expand toggle,
extra action, settings, on/off - the order a reader actually scans it
in). Previously each control was a separate, independently-wrapping
inline element split across two table cells (actions cell + a second
cell just for the expand toggle); at narrower widths they'd wrap onto
separate lines vertically instead of staying one row. Both cells were
merged into one (the header row merges the same way - "Actions" label +
`ExpandAllToggleButton` share one `text-end` header cell now, `colSpan`
on the expanded-detail-panel row dropped from 5 to 4 to match).

`components/IconButton.jsx`'s `center` prop (opt-in, added by the user)
centers a bare `CIcon`'s baseline, which otherwise sits visibly above
middle inside a button. It does this via `align-middle`
(`vertical-align: middle`) on the icon itself, **not** by making the
button a flex container (`d-flex align-items-center justify-content-
center`, the original approach) - flexing the button changes its
auto-height calculation from the font-size/line-height math every
text-labelled button and form control uses to the icon's own ~16px
content box, making icon-only buttons visibly shorter than their
text-labelled siblings in the same row. `align-middle` on the icon fixes
the same baseline offset without touching the button's box model.

## 24. Process public-state broadcast (Redis + Pub/Sub, not `nexus.events`)

An analysis of everything actually flowing over `nexus.events` (section 9)
turned up real scatter on the `process` domain: five independent
`process.<id>.<field>.changed` routing keys (status/critical/warning/
metrics/messages), each its own payload shape, `metrics` publishing
unconditionally despite the `.changed` name, and - the concrete gap - no
Redis-backed snapshot for `process.*` the way `device.*` has (`state:*`,
section 9), so a freshly-connected WebSocket client got every device's
current value immediately but nothing for processes until the next live
change. The UI worked around this with a second mechanism entirely (a
plain REST `GET /processes` for the initial value, WS only for deltas) -
itself part of the scatter this section replaces.

**The bigger call, from the user**: `nexus.events`/RabbitMQ's actual job is
device/node data and commands - potentially many independent consumers,
worth a durable topic exchange. Process public state has exactly two
consumers, ever: this same service (its own REST layer) and
apps/messaging-gateway (WS fan-out to the UI). Neither needs a message
broker's guarantees for this. So process state was pulled off
`nexus.events` entirely, not just reorganized on it - `messaging.ts` is
device-domain only again, and process state flows through Redis alone:

- **`processRegistry.ts`** owns one Redis **hash** per process,
  `process:{id}:public` (fields `status`/`critical`/`warning`/`metrics`/
  `messages`/`updatedAt`) - replacing the previous five independent keys.
  One `HGETALL` (`getPublicState`) reads a process's complete public state;
  each field write (`setStatus`/`setCritical`/`setWarning`/`setMetrics`/
  `setActiveMessages` - the last called from `processMessages.ts` after
  every WEM reconciliation, not owned there) is an `HSET`, so concurrent
  writers touching different fields of the same process's hash can never
  clobber each other the way a read-modify-write JSON blob could.
  `getStatus`/`getCritical`/etc. and their signatures are unchanged from
  before this section - `routes/processes.ts`'s `withLiveState` needed no
  changes at all.
- **`processStateEvents.ts`** - a bare `node:events` `EventEmitter`,
  nothing process-specific about it. `processRegistry.ts`/
  `processMessages.ts` `emit("urgent", ...)` on a transition that matters
  (see below); `processBroadcast.ts` listens. Exists only to avoid a
  circular import - `processBroadcast.ts` already imports
  `processRegistry.ts` to assemble the fleet snapshot, so the reverse
  import (registry -> broadcaster) would cycle; a third, dependency-free
  module both sides import instead breaks that.
- **`processBroadcast.ts`** - the assembler and the only place that decides
  *when* to refresh. `assembleSnapshot()` reads `SELECT id, type FROM
  processes` (Postgres, for the controllable-only status suppression
  `withLiveState` already applied - a permanent/system process reports no
  `status` field at all, not a fabricated `"on"`) plus one
  `getPublicState()` per id, one process's failure logged and skipped
  rather than failing the whole broadcast. `broadcastNow()` writes the
  assembled snapshot to the Redis key `process:state:latest` (JSON blob -
  this one *is* a plain cache key, not a hash, since it's written wholesale
  by one place, not field-by-field by several) and `PUBLISH`es a one-word
  notify on the `process:state:updated` Pub/Sub channel. Two triggers:
  - **Timer** - `startProcessStateBroadcastLoop()`, interval from
    `PROCESS_STATE_BROADCAST_INTERVAL_MS` (`.env`, default 5000) -
    deliberately decoupled from the orchestrator's own 1s compute tick,
    since "live enough for a dashboard" doesn't need to match "how often a
    process re-evaluates its own condition".
  - **Urgent** - `critical`/`warning` transitions and a brand-new active
    WEM entry (`processMessages.syncActiveMessages` inserting a row, not
    updating an existing one's text/level and not a resolve/dismiss) each
    `emit("urgent", ...)`; `scheduleUrgentBroadcast()` debounces/coalesces
    a burst of these into one broadcast (250ms - long enough to cover one
    process's full sequence of sequential HTTP calls from a single
    orchestrator tick, so the coalesced broadcast reads settled state, not
    a write half-applied). `status`/`metrics` changes are deliberately
    **not** urgent (confirmed with the user) - a status flip is already
    reflected in the REST response the UI action that caused it is driven
    from, and a metrics reading a few seconds stale on the bus isn't
    "urgent" the way a fresh critical/warning transition is.
  - **Forced** - `POST /processes/state/broadcast` (`{reason?: string}`,
    fleet-wide, not scoped to one process id - the broadcast itself is
    always the whole fleet) bypasses the debounce and fires immediately.
    Exposed on the orchestrator's `apiClient.ts` as `forceStateBroadcast()`
    per the user's explicit ask ("передбачити можливість пушнути весь стан
    процесів насильно командою з процесу") - not called by any process
    kind today, the capability exists for a future one that needs it.
- **`apps/messaging-gateway`** never touches Postgres and never assembles
  anything - it only relays what `processBroadcast.ts` already put
  together. A **second, dedicated** ioredis connection
  (`subscriberRedis = redis.duplicate()` in `redis.ts` - a connection in
  Pub/Sub subscribe mode can't run regular commands, ioredis's own
  constraint) subscribes to `process:state:updated`; on every message it
  re-reads `process:state:latest` and calls the same `broadcast()` fan-out
  device events already use, under a synthetic routing key
  `process.state.snapshot` (never an actual AMQP key - this data never
  touches RabbitMQ - but reusing the `{routingKey, event}` shape live
  device events carry means a WS client handles both with one code path,
  and a client's own `topics=` pattern can filter this out exactly like it
  would filter out `device.*`). The initial WS-connect snapshot
  (`readStateSnapshot()` for devices, section 9) now also calls
  `readProcessStateSnapshot()` and merges in one more `events` entry if the
  cache key exists - closing the original gap this section started from.

**Public state shape** (`processRegistry.ts`'s `ProcessPublicState`/
`ProcessPublicMessage`, restrained per the user's own framing - "стримано,
без перевантажень, саме необхідне"): `status` (omitted for non-
controllable), `critical`, `warning`, `metrics` (present only for kinds
that report it), and `messages` - the **complete** active/undismissed WEM
list, not a count/severity summary (confirmed with the user) - deliberately
the same shape `GET /processes` already returns, so this is exactly the
"necessary public data" the UI's WEM row renders, not a partial view that
would just push a REST round trip back onto whichever consumer needs the
full list.

**UI adaptation** (`apps/ui/src/api/useLiveProcess.js`): `useProcessLiveState`
rewritten for the new shape - a single incoming `event.domain === 'process'
&& event.eventType === 'snapshot'` message now carries the *whole fleet*
(`event.processes`, one entry per process), so one event replaces every
process's cached entry in `byProcess` in one pass, rather than patching one
field on one process at a time the way the retired per-field scheme did.
Every consumer (`ProcessesTable.jsx`'s `ProcessRow`, `ResourceMonitorPanel.
jsx`) kept working unchanged - the hook's own return shape per process id
(`{status, critical, warning, metrics, messages}`) didn't change, only what
feeds it internally. One real, deliberate cadence regression worth knowing
about: `ResourceMonitorPanel`'s live chart used to sample every second (the
orchestrator's own tick); it now samples at the broadcast's timer cadence
(`PROCESS_STATE_BROADCAST_INTERVAL_MS`, default 5s) unless a critical/
warning/new-message change on some process happens to piggyback an urgent
broadcast sooner - a metrics-only change is not itself an urgent trigger
(confirmed with the user). Verified live: fleet-wide critical/WEM changes
(a real out-of-range Temperature reading) reflected in the row's color and
WEM text with no page reload, `ResourceMonitorPanel`'s chart accumulating
samples, console clean throughout.

**Dashboard tab bug found and fixed after this went live**: `DashboardTab.
jsx`'s eligibility filter (`processes.filter((p) => p.dashboard_flagged_at)`)
read `dashboard_flagged_at` only from the one-time REST load `ProcessesList.
jsx`'s `reload()` produces at mount - never refreshed after that. A process
getting (re-)flagged while the page stayed open (`processMessages.
maybeFlagForDashboard`, unconditional at the end of every `syncActiveMessages`
- section 22) never appeared on Dashboard until something happened to trigger
a full REST reload at the right moment. Reproduced live by the user: clear a
process off the Dashboard, reload the page (REST snapshot correctly shows
"not flagged" at that instant), then the condition recurs server-side and
re-flags it in Postgres - but the already-loaded page never notices. Fixed
by adding `dashboardFlaggedAt` to `ProcessFleetEntry` (`processBroadcast.ts`
- one extra Postgres column on the query `assembleSnapshot()` already runs,
no new round trip) and reading it live in `DashboardTab.jsx` via a new
`useProcessesLiveState()` hook (`apps/ui/src/api/useLiveProcess.js` -
`useProcessLiveState(id)` is now a thin per-id wrapper over it) that returns
every process's live entry at once, not just one row's. The merge is
deliberately `liveEntry ? liveEntry.dashboardFlaggedAt : p.dashboard_
flagged_at`, not `live.dashboardFlaggedAt ?? p.dashboard_flagged_at` - the
field is a nullable timestamp, and `??` would incorrectly fall through to
the stale REST value whenever the live value is legitimately `null` (not
flagged), since `null` is nullish too; checking `liveEntry` itself (present
once any snapshot has been seen for that process, absent only in the brief
window before the first one arrives) avoids that. No new urgent-broadcast
trigger needed - the existing "new active message" trigger (section 24)
already fires at the exact moment `maybeFlagForDashboard` sets the flag, so
the very same broadcast that makes a WEM entry appear live also carries the
now-current flag. `hasActiveWem` (gates the remove-X's disabled state) was
deliberately left REST-only - live-tracking it would mean one extra Postgres
query per process per broadcast (`processMessages.hasActiveEntries`, not
backed by the Redis hash `processBroadcast.ts` otherwise reads for free),
and the failure mode of it going briefly stale is self-correcting (a 400 from
the server, not a silent inconsistency) - not worth that added DB load for
what wasn't the reported problem.

**Reversed (2026-07)**: that "self-correcting" call was wrong about the
actual failure mode. Staleness doesn't just delay the X becoming enabled -
if the underlying condition resolves while the page stays open, the REST
snapshot is never re-read at all, so the disabled state never clears,
ever (reported live as "the button doesn't react to clicks at all," easy
to miss since a disabled icon button looks nearly identical to an enabled
one). Fixed by giving `hasActiveWem` the exact same live treatment as
`dashboardFlaggedAt` above - added to `ProcessFleetEntry`, computed in
`assembleSnapshot()` via `Promise.all([processRegistry.getPublicState(id),
processMessages.hasActiveEntries(id)])` (parallel, not sequential; the one
extra Postgres query per process this reintroduces was accepted as the
cost of a correct disabled state), and read in `DashboardTab.jsx` with the
identical `liveEntry ? liveEntry.hasActiveWem : process.hasActiveWem`
pattern. Separately, clearing the flag (`DELETE .../dashboard-flag`) used
to leave the UI to notice via the next periodic/urgent tick, so a
successful removal could still visibly linger for up to a full broadcast
interval - the route now ends with `await broadcastForced("dashboard-flag-
cleared")` right after the flag-clearing `UPDATE`, so the row disappears
the instant the click succeeds, not on the next tick. Verified live: an
out-of-range Temperature Safety Monitor entry showed its remove-X
correctly disabled; resolving the condition (no reload) flipped it to
enabled within one broadcast interval; clicking it removed the row
immediately, console clean throughout.

## 25. Notification center (header WEM icons + popup)

Global, cross-process view of WEM (Warnings/Errors/Messages, section 22) -
distinct from a process's own WemRow (which only ever shows that one
process's *currently active* entries). Three header icons (`apps/ui/src/
components/header/NotificationCenter.jsx`, wired into `AppHeader.jsx`),
each opening the same `NotificationCenterModal.jsx` preset to its type.

**Read/unread model**: reuses `process_messages.hidden` as the read marker
for *every* type, not just `message` - dismissing an entry in this popup
is the same act as dismissing it anywhere else, global (not per-user),
same reasoning `hidden` already had (section 22). `setHidden`'s old type
restriction (only `message` could be dismissed) is gone from
`processMessages.ts` - `apps/ui`'s WemRow.jsx still only ever *renders*
its own dismiss button for `message` (that surface's intent, "stop
showing this on my process card", is unchanged), but the backend no
longer enforces it structurally, since this popup needs to dismiss
warning/error rows too and there is now only one dismiss action in the
system. Two new columns record who/when (`hidden_by` FK users ON DELETE
SET NULL, `hidden_at` - migration `1690000000022`) - `PATCH /process-
messages/:messageId` is the one route in this whole surface that requires
auth (`requireAuth`, section 13), specifically so `request.user.sub` is
trustworthy instead of a spoofable client-supplied id; this never
actually blocks a real user since AuthGate already covers the whole UI.

**Consequence worth knowing**: marking an *active* warning/error as read
via this popup also removes it from `listActiveMessages`, which is what
the process's own WemRow and the fleet broadcast's `messages` field both
read from (section 24) - so acknowledging a still-active warning here
makes it disappear from the process's own detail panel too, even though
the row may still be highlighted red/yellow (that highlight is the
independent `critical`/`warning` boolean, not derived from `messages`).
Deliberate, per explicit direction, not an oversight.

**Unread counters**: Redis-backed (`wem:unread:{message,warning,error}`,
`processMessages.ts`), not a live `COUNT(*)` per header render. Recomputed
from Postgres once at boot (`initUnreadCounts()`, `index.ts`, ahead of the
first broadcast tick - Redis is ephemeral, Postgres is the source of
truth); incremented by 1 per genuinely new row `syncActiveMessages`
inserts (not a text/level update, not a resolve); decremented/incremented
by `setHidden` on an actual hidden-flag flip. Folded into the *same*
fleet-wide broadcast envelope as process state (`ProcessFleetSnapshot.
unreadCounts`, `processBroadcast.ts`) rather than a second parallel
channel - per the user's own explicit direction ("Додай лічильники до
Redis... Додавай ці дані до потоку WebSocket"). `apps/messaging-gateway`
relays whatever's in the cached snapshot verbatim - its `toProcessStateEntry`
helper has to be kept in sync by hand with every field `processBroadcast.ts`
adds to the envelope (found live: forgot `unreadCounts` there on the first
pass, header badges silently stayed at zero even though Postgres/Redis had
the right numbers and the WS payload reached the browser - the gateway was
just dropping the field on the floor while reconstructing the envelope
field-by-field instead of spreading the cached object).

**Two independent live signals per header icon**, both riding that same
broadcast, not one styled two ways: color (neutral vs tinted) is driven by
`useUnreadCounts()` (`useLiveProcess.js`), `> 0` unread; the `.wem-blink`
animation (`style.scss`, warning/error only, deliberately fast/dramatic
per "дико блимають") is driven by whether *any* process currently has
`critical`/`warning` true (`useProcessesLiveState()`), regardless of
unread count - an already-read but still-active condition still blinks,
an unread-but-resolved one does not.

**Server-side pagination** (`GET /process-messages?type=&scope=&
processId=&search=&page=&pageSize=`, `processMessages.listProcessMessages`)
- the first list in this app that isn't client-side (section 11's "tens
of rows" doesn't hold for an append-only log that only grows; this
session's own test data alone reached 2800+ warning rows). Historical
only - `scope` is `"new" | "all"`, no `"active"` (see below, that tab
doesn't call this route at all). `type` accepts `"all"` too (no `pm.type`
condition at all) alongside the three real `MessageType`s. `processId`/
`search` (`ILIKE` on `text`) are additional optional filters, built as a
dynamic parameterized `WHERE` (conditions/values arrays, not string
interpolation) since which filters are present varies per request.
`NotificationCenterModal.jsx` reuses `TablePagination.jsx` as-is (a purely
controlled/presentational component, already agnostic to client- vs
server-driven paging) rather than building a new pagination widget - only
the state feeding it (fetched `total`/`page`, not a sliced in-memory
array) is new. Every filter setter (type/tab/process/search/page size)
resets `page` to 1 in the same event handler that changes the filter, not
a separate effect watching for the change - avoids the `react-hooks/
set-state-in-effect` anti-pattern for what is genuinely a direct
consequence of the user's own click, not derived state to reconcile
after the fact.

**Date display** (`apps/ui/src/utils/format.js`'s `formatSmartDateTime`) -
Today/Yesterday/date + time-to-the-minute, new alongside the existing
`formatDateTime` (full locale string, too wide for a dense feed) and
`formatRelativeTime` ("N minutes ago", right for one last-updated field,
reads badly repeated down a whole column where every row needs its own
reference point).

### Cosmetic revision pass (after first ship)

A round of fixes to the shipped feature above, from watching it live:

- **Fixed modal height.** `NotificationCenterModal.jsx`'s `CModalBody` is
  a flex column with an explicit `height: '70vh'` and an inner `flex-
  grow-1 overflow-auto` region around the table/empty-state/spinner -
  previously the modal's own height tracked whatever the current tab
  happened to return, visibly jumping on every tab switch.
- **"All" in the type selector.** A fourth option (`cilBell`, secondary)
  alongside the three real types, kept in `NotificationCenterModal.jsx`'s
  own `TYPE_OPTIONS`, not in `WEM_TYPE_META` - "All" has no unread count
  or blink state of its own, so it doesn't belong in the map the header
  icons iterate.
- **Active tab moved off REST, onto live process state.** Every process's
  own `messages` array in the fleet broadcast (section 24) is already
  exactly "currently active, unhidden" for that process - the Active tab
  now flattens `useProcessesLiveState()` across every process
  (`message`-type entries excluded, no active concept for those),
  filters/sorts client-side, and needs no pagination (inherently a small,
  transient set). Process *names* aren't in the live payload (only
  `process_id` implicitly, via which key in the map an entry came from) -
  `NotificationCenterModal.jsx` fetches `GET /processes` once on mount
  (cheap, a few dozen rows) to build an id->name lookup, reused for both
  this and the process filter dropdown below. Every Active-tab row is
  inherently unread (an entry with `hidden: true` is excluded from
  `listActiveMessages`/the live `messages` array by construction, section
  22) - dismissing it needs no explicit refetch either, the broadcast
  that follows the dismiss already drops it from the live list on its
  own.
- **Process + search filter row**, between the tab strip and the list,
  applying to all three tabs alike (client-side for Active, query params
  for New/All).
- **Columns reordered to Time/Process/Message/Status** (was Process/
  Message/When/Status), and the message `text` cell is colored
  (`text-{success,warning,danger}` off `WEM_TYPE_META`) in every tab now,
  not just when "All" is selected - needed once mixed-type rows became
  possible at all (previously every visible row already shared the
  header icon's own type, so per-row color would have been redundant).
  Status column simplified: no more "New" badge (unread = bare dismiss
  `X`, nothing else) and no more the read entry's name spelled out next
  to its avatar (still available on hover via the avatar's `title`).
- **Header icon blink bug + visual contrast**, both reported live:
  1. Warning and error icons were blinking *together* off one shared
     `critical || warning` boolean - a process is never both at once
     (critical always wins, section 21), so this made the warning icon
     blink for an error-only condition and vice versa. Split into two
     independent flags (`hasActiveWarning`/`hasActiveError`,
     `NotificationCenter.jsx`), each driving only its own icon.
  2. The original blink (`.wem-blink`, plain opacity fade on the icon's
     own outline) was too subtle to notice at a glance. Replaced with
     `.wem-blink-ring` (`style.scss`) - a solid `bg-{color}` disc behind
     the icon that pulses opacity, paired with a white icon on top while
     blinking - reads as "inverse" (colored fill, light silhouette)
     without needing filled/inverse icon variants CoreUI's `cil` set
     doesn't have.
- **Circular-import bug, found live.** `NotificationCenter.jsx` renders
  `NotificationCenterModal`, which reused `WEM_TYPE_META` from
  `NotificationCenter.jsx` - a real cycle that only "worked" as long as
  both sides only touched the constant inside render (JSX/callbacks), not
  at module-evaluation time. Adding `TYPE_OPTIONS` (`Object.entries(
  WEM_TYPE_META)`) at `NotificationCenterModal.jsx`'s own module top level
  exposed it - `WEM_TYPE_META` could still be `undefined` at that point
  depending on which side of the cycle the bundler evaluated first,
  throwing `Cannot convert undefined or null to object` and blanking the
  whole page. Fixed by extracting the shared constant into its own
  dependency-free module, `wemTypeMeta.js`, that both sides import
  independently - not a workaround, the actual fix, since the cycle
  itself (not just its current trigger) is what was fragile.

### Second cosmetic pass

- **Even taller modal** - `88vh` now (was `70vh`), per direct request once
  the first fixed-height fix landed. Same mechanism, just a bigger number.
- **Bulk "mark as read"** - a checkbox per unread row (none on already-
  read rows - nothing for the action to do to them) plus one header
  checkbox that selects/deselects every currently-unread row *in `rows`*
  (the current page for New/All, the whole live list for Active - not
  "every matching row across all pages", which would need a very
  different, server-side bulk primitive). Selection is ids only, in its
  own `selectedIds` state, cleared by every navigation-changing handler
  (type/tab/process/search/page-size/page) - a selection made against one
  filtered result set silently carrying over onto a completely different
  one the user hasn't looked at would be surprising. The "Mark as read
  (N)" button (`CButton`, appears only once something's selected) fires
  `Promise.all` over `api.hideMessage` for every selected id - no new bulk
  endpoint, N individual `PATCH`s is fine at this scale (a page's worth of
  rows, not thousands).

## 26. Shared visual atoms (indicators, Switch, ResetFiltersButton)

A small, explicitly named "elementary visual components" layer, requested
alongside a specific Temperature Control cosmetic pass - things that used
to be redrawn ad hoc per call site now live once, each with a single
visual job.

**`apps/ui/src/components/indicators/`** (`constants.js`'s `INDICATOR_SIZE
= 48`, matching the size the very first ad hoc version - TemperatureProcessPanel's
old inline `Indicator` - already had):
- **`StatusIndicator.jsx`** - a bold black circular bezel (`border`, not a
  second nested element) around a fill that reads the boolean state:
  light gray inactive, `color` (a prop, no fixed palette) active. Replaces
  the local `Indicator` that used to live inline in TemperatureProcessPanel.
  jsx (now `LabeledIndicator`, a thin label wrapper around this - the
  label itself isn't this component's concern, purely elementary).
  Cooler/Heater keep their existing colors (blue/red) - only the visual
  *treatment* changed, not what each one represents.
- **`BuzzerIndicator.jsx`** - a different physical metaphor, not just a
  StatusIndicator recolored: the *whole body* is black idle / red active
  (not an inner fill against a fixed bezel), with a small fixed light-gray
  "grille" dot in the center that never changes color, purely decorative
  - reads as a microcontroller-board piezo buzzer, not an LED. Built
  ahead of any call site that uses it - not wired into any process view
  yet, a deliberately unused primitive waiting on the component that will
  need it.

**`apps/ui/src/components/Switch.jsx`** - a large left-right toggle, not
CoreUI's `CFormSwitch` (Bootstrap's own switch styling is thin/small and
not straightforward to recolor per instance - this needs to be both
bigger and take its own colors). `activeColor`/`inactiveColor` are props
(default green/light-gray), not a fixed palette - this component makes no
assumption about what "on" should look like beyond its own default.
Wired into `ProcessesTable.jsx`'s `ProcessRow` for exactly the ON/OFF
action pair (`isOnOffActions()`, order-independent check on `process.
actions`) - the original per-action `CButton` rendering is still there,
completely intact, as the `else` branch for any other action set (the
still-unimplemented START/PAUSE/STOP, section 10) - explicitly kept, not
deleted, since ON/OFF happening to be the only action set that exists
today doesn't mean it always will be.

**`apps/ui/src/components/ResetFiltersButton.jsx`** - the reset-filters
control every filter row in this app now shares (previously duplicated
inline, `ProcessesTable.jsx` and now `NotificationCenterModal.jsx`'s new
process/search filter row too). Fixes a real bug in the original inline
version: it passed `variant={undefined}` to `IconButton` trying to get a
solid look, but `IconButton`'s own `variant = 'outline'` default parameter
kicks in for an explicitly-`undefined` value exactly the same as an
omitted prop - so the button was actually rendering `variant="outline"`
the whole time (white/yellow-bordered, solid yellow only on `:hover`,
matching the reported symptom precisely). `ResetFiltersButton` is its own
small component built directly on `CButton` instead, `variant` simply
never passed at all (CoreUI's own default there is solid) - solid warning-
yellow always, not just on hover. Height-matched to sibling `size="sm"`
`CFormSelect`/search inputs the same way `IconButton`'s own `center` prop
already does it (`align-middle` on the icon, not a flex-centered button -
flexing shrinks the button's auto-height below the line-height-driven
size every other `size="sm"` control in the row uses, section 23's
original finding). `active` prop controls its own visibility (`null` when
false) - one prop covers both "should this render" and "onClick", not two
things every caller has to gate separately.

## 27. Active Zummer (first sound-output process/device)

The platform's first physical-alarm device and the first real consumer of
Message Levels (section 22/23's `message_levels` table, which sat as
config-storage only until now). A single active buzzer - built-in tone
generator, driven purely 0/1 - modeled as a real device type under
`devices/standalone/active-buzzer/` (same layout as `light-regulator`,
section 7): `contract.schema.ts`, `edgex-device-profile.yaml` (mirrored
into `apps/device-service/res/profiles/NexusEdge-ActiveBuzzer.yaml` +
`res/devices/active-buzzer-devices.yaml`, seeded into Postgres by
`apps/api/migrations/..._seed-active-buzzer-device.ts` - device `active-
buzzer-01`, single non-`readOnly` `Buzzer` resource, ordinary AUTO/MANUAL
actuator like Cooler/Heater, not a sensor). No `runtime/`/`firmware/` yet -
same reasoning as light-regulator, nothing for either to add over the
generic Virtual Node Runtime, and no hardware exists yet. **Real mapping,
not built yet**: CAN -> STM32 -> a single digital output port (Port0/1) -
the user's own stated plan, to be implemented once the ordered hardware
arrives.

**Process**: `active-buzzer` kind, "Active Zummer", controllable (`ON`/
`OFF` - an operator can globally silence/enable the feature, same Switch
UI as Temperature Control), seeded by `apps/api/migrations/..._seed-
active-buzzer-process.ts` into the existing `System` process group,
`device_id` -> `active-buzzer-01`. No process-level config (unlike
Temperature Control's min/max) - the entire beep policy lives in
`message_levels`, shared across every future sound-output process, not
duplicated per-process.

### Alarm policy (`apps/orchestrator/src/alarmPolicy.ts`)

A new shared module, deliberately not buried inside the buzzer's own
process file - the user's own stated plan is more than one sound-output
device eventually (some controllable, some not), each needing the same
priority/lookup logic without re-deriving it. `determineAlarmPlan(
activeLevelsByType, messageLevels)`:

- **Priority**: `ALARM_TYPE_PRIORITY = ["error", "warning"]` - error always
  wins today (confirmed with the user, who explicitly said priority
  handling will grow later - more types, and real per-producer severity
  levels beyond the placeholder `1` every kind sends today). An ordered
  array, not a hardcoded if/else, so extending this later is a one-line
  change here, not a rewrite of every caller.
- Within the winning type, the *highest* active level wins; that exact
  `(type, level)` row's `mode`/`period_deciseconds` (Settings -> Message
  Levels, already-existing UI, no changes needed there) is the plan. A
  configured `"off"` at the winning type/level stops there - it does
  **not** fall through to a lower-priority type, since the higher-priority
  condition is still genuinely active; the admin simply chose silence for
  it. This "off doesn't fall through" behavior is a deliberate design
  choice (not explicitly specified by the user), reasoned from how a real
  hierarchical alarm panel behaves - revisit if that turns out wrong.
- Only level 1 is real today for both types (matches the user's own
  request scope - "error 1", "warning 1"; levels 2-4 deferred, same as
  every other level already was).

**Safety-critical data source**: `activeLevelsByType` is deliberately
**not** derived from any process's `messages` array (`GET /processes`'
`withLiveState`) - that field excludes entries a user has hidden
(dismissed) in the notification center (section 22/25), and a dismissed
notification must never silence a still-active physical alarm (dismissing
means "I've seen it", not "the condition cleared"). Instead,
`activeBuzzer.ts` derives a synthetic `[1]`/`[]` per type straight from
the existing unfiltered `critical`/`warning` booleans (`process.critical`/
`process.warning`, now also declared on `apiClient.ts`'s `ProcessRecord` -
previously undeclared there even though `GET /processes` always returned
them, since no orchestrator process had ever needed to *read* another
process's flags before this one).

### Private tick (`apps/orchestrator/src/processes/activeBuzzer.ts`)

The shared 1s `RUNNERS` tick (`index.ts`) is too coarse to pulse a buzzer
sub-second, so `runActiveBuzzer` only *decides*, once a second, whether a
private per-process timer should be running and with what period - the
timer itself does the actual fast toggling, independent of the main loop:

- `constant` mode needs no timer - `Buzzer` is just held `true` directly
  for as long as the condition (and the process) stays on, exactly as the
  original request specified ("постійний сигнал обробляється без тіку").
- `shortBeep`/`longBeep` start a `setInterval` at the admin's own
  `period_deciseconds` (the repeat cadence, already user-editable); each
  firing sets `Buzzer` true then a `setTimeout` turns it back off after a
  fixed **on-duration constant** - `SHORT_BEEP_ON_DECISECONDS = 2` (200ms
  chirp) / `LONG_BEEP_ON_DECISECONDS = 8` (800ms tone), invented defaults
  since no real hardware/spec existed yet to derive them from (per the
  user's own instruction: the per-level `mode` choice is *which* of these
  two fixed patterns plays, not a per-level tunable duration). Clamped to
  never exceed the period itself, so a misconfigured short period doesn't
  produce a negative off-window.
- Timers are keyed by `process.id` (a `Map`), not a single module-level
  handle - nothing stops a second buzzer-kind process existing later.
  Restarts only when `mode`/`periodDeciseconds` actually changed (not
  every tick) - same "no-op when nothing changed" discipline as
  `setCritical`/`setWarning`.
- `ON`->`OFF` edge handling mirrors `temperatureControl.ts` exactly: forces
  `Buzzer` false (and stops any running timer) once, on the transition,
  not unconditionally every tick while off.
- Reaction latency to a condition resolving is up to 1s (the shared tick's
  own cadence) before the private timer stops - acceptable and consistent
  with every other kind's `critical`/`warning` transition latency; only
  the beep *pattern itself* needed sub-second precision, not the
  react-to-resolution edge.

`apiClient.ts` gained `getMessageLevels()` (`GET /message-levels`, read
fresh every tick - an admin edit in Settings should take effect on the
very next tick, not require a restart) and a `MessageLevelRecord` type
mirroring the table's own snake_case `period_deciseconds` (no camelCase
transform happens server-side for reads, only the PATCH body accepts
camelCase).

### UI

`apps/ui/src/views/processes/ActiveBuzzerPanel.jsx` (new `KIND_PANELS`
entry) - no config to edit (unlike Temperature Control), just a live
visualization via the shared `BuzzerIndicator` atom (section 26 - built
ahead of time, unwired, specifically for this) fed by
`useDeviceLiveState(process.device_id)`, same live-preferred-over-REST
pattern as `TemperatureProcessPanel`. `devices/standalone/active-buzzer/
ui/control/ActiveBuzzerControl.jsx` (registered in `DeviceDetail.jsx`'s
`DEVICE_TYPE_CONTROLS`, matching light-regulator's convention) is a
separate, self-contained lamp - device-type components can't import
`BuzzerIndicator` directly (cross-package `@coreui/react`/app-component
boundary, section 7), so it's visually identical but independently
implemented. No custom `ui/simulator` - a plain `Bool` actuator is already
well served by the Dev Simulator's generic instant checkbox, unlike
light-regulator's ranged `Level`.

Verified live: `error` level 1 set to `constant` sounded the buzzer solid
the instant a real error (Temperature Safety Monitor) went active, and
silenced it the instant the condition cleared - no page reload, in both
the Processes panel and the Devices detail page. `warning` level 1 set to
`longBeep` at a fast test period showed genuine on/off pulsing (sampled
device state across ~2s). Turning the process `OFF` mid-error correctly
forced and held the buzzer silent despite the fleet-wide error staying
active, then resumed reacting to it immediately on `ON`. Console clean
throughout; test thresholds/periods reset to their prior values afterward.
