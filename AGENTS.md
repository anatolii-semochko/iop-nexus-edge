# AGENTS.md

Rules and context for anyone (human or AI agent) working in this repository.
Read this file before making changes. Keep it updated: whenever you add an
important service, module, component, or make an architectural change, update
this file and `README.md` accordingly.

See `docs/PROJECT_MASTER-1.1.md` for the full architecture vision.

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
docs/           project documentation (empty for now)
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
  hardware protocols directly.
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
  Nothing calls this yet (`apps/orchestrator` has no automation logic yet),
  but it is real, tested Devices API surface, not speculative scaffolding.
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
doesn't flood the API); a `NumericStepper` component (±1 buttons plus a
signed two-decimal-place text input, `apps/ui/src/views/devices/
NumericStepper.jsx`) is the one control that still has an explicit commit
step (Enter or "Set") for anything else (e.g. `Temperature`) - free-typing a
number a character at a time must not fire a write per keystroke. It also
shows a device-wide "Auto value" column next to "Current value" (both
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

## 10. Running the stack

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
