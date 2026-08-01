# AGENTS.md

Rules and context for anyone (human or AI agent) working in this repository.
Read this file before making changes. Keep it updated: whenever you add an
important service, module, component, or make an architectural change, update
this file and `README.md` accordingly.

See `docs/PROJECT_MASTER-1.1.md` for the full architecture vision,
`docs/DEVELOPMENT_LOG.md` for the dated history of how this platform got
to its current state and why, and `docs/CREATING_A_TARGET_PROJECT.md`
for the manual checklist to bootstrap a new project on top of this one
(section 31's extension points design).

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
- `res/profiles/NexusEdge-Example-{Temperature,Heater,Cooler,Switch}.yaml`
  and `res/devices/example-devices.yaml` are a smoke-test fixture, not a
  real device type — remove them once real device types are provisioned
  the intended way (via the Device Registry, not a static file baked into
  the service). (Split from one bundled `NexusEdge-Example-Virtual.yaml`
  into these four single-value profiles by the 2026-07-28 Device/Node
  correction, section 30.)

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
now (`apps/api/src/dualDevicesModel.ts`), keyed **per device**, not per
(device, resource) - a `AGENTS_TO_DO.md`-documented correction from 2026-07-28
(see section 30). The original design generalized this to `(device,
resource)`, reasoning that "a single-purpose device is just the case where
it happens to have one resource" - that framing had the entity boundary
backwards: a **Device is atomic** (one interface/protocol = one value,
`section 7`), and what were being called "resources" on one bundled device
(e.g. a temperature sensor and two relays sharing one EdgeX device purely
for demo convenience) were actually three separate physical devices that
had been incorrectly modeled as one. Redis keys: `dvm:{deviceId}:{mode,
valueAuto,valueManual}`.

- `PUT /devices/:id` (the UI write path) is `setManualActive`: any direct
  UI write both sets `valueManual` and switches the device to `MANUAL` — a
  UI write *is* what "MANUAL" means.
- `PUT /devices/:id/auto` is `setActive` — records `valueAuto`, but only
  reaches EdgeX while the device is still `AUTO`. First real caller:
  section 10's "Temperature Control" process.
- `POST /devices/:id/release` returns a device from `MANUAL` to `AUTO`,
  immediately pushing whatever `valueAuto` the orchestrator kept computing
  in the background — verified live (both before and after the
  per-resource → per-device correction): set `Cooler` active via `/auto`,
  override it `MANUAL` via the plain `PUT`, call `/auto` again (confirmed
  it does *not* reach EdgeX while `MANUAL`), then `release` (confirmed the
  backgrounded `valueAuto` takes over immediately).
- `GET /system/mode` derives the aggregate `AUTO`/`SERVICE`/`MANUAL` from
  the *full* device list in Postgres (not just whatever happens to have a
  Redis key) — a device untouched in Redis is implicitly `AUTO`, and
  omitting it from the count would wrongly report `MANUAL` after a single
  override among many devices (a real bug caught during testing, not
  hypothetical).
- The Model State Validator (section above) now reads the *other* device
  values it needs from this Redis state (via `resolveActiveValue`, falling
  back to a live EdgeX read only the first time a device is ever touched,
  then caching it as the initial `valueAuto`) instead of live EdgeX reads on
  every write — resolves the simplification noted when the validator first
  shipped.
- Not yet done: no consistency-check job reconciling Redis against EdgeX's
  actual state (the "if a scheduled consistency check finds a mismatch, an
  error is raised" part above). Cross-device rules **are** now possible
  (section 7) — that was the specific gap the per-resource model couldn't
  close, and closing it is what motivated the correction.

**Read-only devices have no Dual Devices Model state at all** - not a
third mode, an *absent* one. A pure sensor (e.g. `Temperature` on the
example thermal node, `Level` on the Light Regulator - section 7) is
declared `readOnly: true` in `devices.capabilities` (Postgres, a flat
object now, not an array - section 7); `GET /devices/:id` then omits its
`dualState` entirely rather than defaulting to `AUTO` (a device nothing
ever commands isn't meaningfully "automatic"), and `PUT /devices/:id` /
`.../auto` / `.../release` all reject it with 400 - there is no `MANUAL`
to enter or `AUTO` to return to. The EdgeX device profile for such a
device still declares its resource `RW`, not `R` - EdgeX itself refuses
writes to an `R` resource outright (405), which would make it impossible
to ever push a new reading through core-command at all. Devices API is
what actually enforces "no ordinary command surface for this device", via
a separate dev-only path: `PUT /devices/:id/simulate` writes straight to
EdgeX core-command, bypassing the Dual Devices Model entirely (mirrors a
physical sensor producing a new value on its own), and publishes it
exactly like a controllable device's write does
(`dualDevicesModel.publishReading` - `state:*` cache + `nexus.events`, see
section 9), just without a mode/valueAuto/valueManual - a plain `{value,
timestamp, source}`. `publishReading` deliberately does **not** log to
`log_device` anymore (section 22/29/30) - the old unconditional "log every
tick" behavior was removed outright in the same 2026-07-28 correction, by
direct instruction; a future configurable process decides what/when to log.

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

Layout (revised 2026-08-01, section 32's Library Catalog decision - see
below for what changed and why):

```
devices/
  nodes/
    <node-type>/                     e.g. aquarium-maintenance-node
      node.yaml                      node identity schema, bus binding,
                                      defaults, and a `supports:` list of
                                      device-type names this node type is
                                      typically paired with (a reference,
                                      not physical folder nesting)
      safety.yaml                    CROSS-DEVICE forbidden-state/interlock
                                      rules for this node type's typically-
                                      paired devices (nodes.forbidden,
                                      Postgres) - see below, added 2026-07-28
      firmware/                      shared STM32 project for the node (main,
                                      build)
      category.json / <icon>         optional - only if this node type also
                                      acts as a Library Catalog category
                                      (arbitrary nesting under nodes/ or
                                      standalone/, section 32)
      library.json                   Library Catalog descriptor for this
                                      node type itself - {id, name,
                                      description}, `id` developer-assigned
                                      once, never changes (section 32)
  standalone/
    <device-type>/                    e.g. co-valve - every Device type
                                       lives here now, independent of any
                                       Node (section 32) - own bus binding
                                       lives in contract.schema.ts, own
                                       safety.yaml IS the final word for
                                       any rule that's genuinely about this
                                       device alone
      contract.schema.ts              single capability/type contract (sensors,
                                       actuators, commands, units) — source of truth
                                       that the UI, Virtual Node Runtime and Devices
                                       API normalization are checked against
      edgex-device-profile.yaml       EdgeX Device Profile (one resource - a Device
                                       is atomic, exactly one value)
      safety.yaml                     this device type's OWN forbidden-state
                                       rules, if any; a rule between this device
                                       and another belongs on whichever node
                                       type's safety.yaml documents that pairing
                                       (nothing else reads this file across
                                       device types)
      runtime/                        Virtual Node Runtime module (Go), mirrors
                                       the STM32 behavior (optional - absent
                                       where nothing beyond the generic Virtual
                                       Node Runtime is needed)
      firmware/                       STM32 driver module for this device type
                                       (every standalone device type needs its
                                       own - there's no node-level project to
                                       be included into)
      ui/
        control/                      production control/visualization component,
                                       integrated into the main UI
        simulator/                    dev-mode panel: shows internal state, allows
                                       overriding sensor values for testing
      config/
        default-state.yaml            initial virtual state + tunables (no hardcoded
                                       values)
      docs/
        README.md
        schematics/
      tests/
      CHANGELOG.md                    hardware/firmware revision history for this
                                       type, since it will drift from the original
                                       definition over time
      category.json / <icon>          optional - only if this device type also
                                       acts as a Library Catalog category
      library.json                    Library Catalog descriptor - {id, name,
                                       description}, `id` developer-assigned
                                       once, never changes (section 32)
```

**2026-08-01 correction (section 32):** `devices/nodes/<node-type>/devices/`
(a device type physically nested inside its node type's own folder) is
gone - every Device type now lives under `devices/standalone/`
unconditionally, whether or not it's typically used with a Node. A node
type declares which device types it's typically paired with via a
`supports:` list in its own `node.yaml` (a reference by name, checked by
nothing at runtime - purely informational for the Library Catalog), not
by owning a copy of that device type's folder. This was forced by the
Library Catalog's own requirement that a Device and a Node be independently
browsable/movable/categorizable (moving a Device into a new category
folder must never require touching any Node's folder, and vice versa) -
also the point that a device type in principle could be reused by more
than one node type, which physical nesting under exactly one node
couldn't represent anyway. `devices/nodes/example-thermal-node/` (added
2026-07-28, section 30) - its four device types (`temperature`, `heater`,
`cooler`, `switch`) moved to `devices/standalone/` accordingly, with the
actual Heater/Cooler interlock rule staying on the node type's own
`safety.yaml`/`nodes.forbidden` (unaffected - that was always about a
physical assembly, section 30 already got this half right), not
duplicated into either device type's.

`devices/standalone/light-regulator/` and `devices/standalone/
active-buzzer/` are real device types built to this layout - `runtime/`
and `firmware/` are deliberately absent for both (nothing for either to
add over the generic Virtual Node Runtime yet, no hardware to target),
everything else (`contract.schema.ts`, `edgex-device-profile.yaml`,
`safety.yaml`, `config/default-state.yaml`, `docs/`, `tests/`,
`ui/control`, `ui/simulator` where applicable, `CHANGELOG.md`) is present
and real.

**Implementation status**: the Postgres side of the Device Registry exists
now (`apps/api/migrations`, `node-pg-migrate`) - `nodes` and `devices`
tables, run automatically on every `apps/api` container start (idempotent;
node-pg-migrate tracks what's applied). `devices.capabilities` is a **flat
object** (`{edgexResource?, readOnly?, min?, max?, step?}`, not the array
of named resources this used to be, section 30) - a Device is atomic, so
"0 or 1 resource" collapsed to "0 or 1 value directly on the row".
`edgexResource` is which EdgeX deviceResource/command name this device's
single value is called under - an internal detail of talking to EdgeX
(`apps/api/src/edgex.ts`), not a client-addressable dimension - there is no
`.../resources/:name` anywhere in the URL space anymore. `forbidden` moved
off `devices.capabilities` entirely, onto `nodes.forbidden` (an array of
`{when: {device, equals}, conflictsWith: {device, equals}}`, `device`
being a name resolved within that same node) - the richer
`contract.schema.ts` contract described above exists per device type today
but nothing reads it across a process boundary yet, kept in sync by hand.
`devices.edgex_device_name` is how a registry row optionally links to an
already-provisioned EdgeX device - there is still no write-side
provisioning flow (registering a Postgres row does not create the EdgeX
device, or vice versa; every device type so far was wired up the same
manual way - a static `apps/device-service/res/devices/*.yaml` entry plus
a Postgres seed migration).

`apps/api` exposes this over HTTP: `GET /nodes`, `GET /nodes/:id` (registry
only), `GET /devices` (registry rows plus, for any with an
`edgex_device_name`, that device's live `operatingState`/`adminState` from
one core-metadata call), `GET /devices/:id` (registry row plus the device's
live `value`/`valueType`/`units`, read from EdgeX core-command, and - for a
*controllable* device only - its Dual Devices Model `dualState` - see the
read-only-devices note in section 6), `PUT /devices/:id` (Model State
Validator, then proxies the write to EdgeX core-command; used by the UI's
dev simulator page for controllable/actuator devices), `PUT
/devices/:id/auto` (orchestrator-driven, `setActive`), `POST
/devices/:id/release` (`MANUAL` back to `AUTO`), and `PUT
/devices/:id/simulate` (the equivalent of the plain write for `readOnly`
sensor devices - section 6). None of these take a `:resource` URL segment
anymore (section 30) - each Device has exactly one value.

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

**Model State Validator** (`apps/api/src/validator.ts`) sits in front of
that write path. Rules are declared per **node** in `nodes.forbidden`
(Postgres) - `{ when: { device, equals }, conflictsWith: { device, equals
} }`, `device` a name resolved among that node's own devices - and
rejected writes get a `409` with a reason. **Cross-device now, not
cross-resource on one device** (section 30, 2026-07-28 correction) -
originally declared per-device as `devices.capabilities.forbidden` with
`{resource, equals}` pairs, back when Heater/Cooler were (incorrectly)
resources on one bundled device; moved to the node the moment they became
the two separate devices they always physically were. The example thermal
node's `Heater`/`Cooler` interlock (section 6's running example - "heating
and cooling must never be active at once") is the rule that motivated
both the original mechanism and this correction, still real and tested
either way. One simplification still true after the correction: the
validator re-reads the *other* device's current value via
`dualDevicesModel.resolveActiveValue` (Redis-cached, section 6) rather
than a live EdgeX read on every write - resolved in the original
implementation, unaffected by this one.

`apps/ui` has a first "Devices" section: Nodes list, Devices list, a generic
device detail (production-style, read-only), and a Dev Simulator page
(virtual devices only, one row per device, override column per device).
Since a Device carries exactly one value (section 30), there is no longer
a per-device resource table to sort or reshuffle - both detail views show
a single value directly. Each dispatches to a device type's own
`ui/control`/`ui/simulator` component when one exists (`DEVICE_TYPE_CONTROLS`
/ `DEVICE_TYPE_SIMULATORS` maps, keyed by `device.type` - flat now, no
resource-name sub-key, since there is only ever one value per device -
today the Light Regulator's `ui/control`+`ui/simulator` and the Active
Zummer's `ui/control`), falling back to the generic row otherwise. The Dev
Simulator's override column is instant - no "Set" button - for `Bool`
(checkbox, decided by the device's live `valueType`) and any
device-type-specific control (e.g. the Light Regulator's slider, debounced
150ms so dragging doesn't flood the API); a `NumericStepper` component
(`apps/ui/src/views/devices/NumericStepper.jsx`) is the +/- control for
anything else (e.g. `Temperature`) - no free-text input at all (an earlier
version had one, gated on matching an exact signed two-decimal pattern
before "Set" would even enable, which was confusing enough to remove
entirely), each button commits immediately. A quick click steps once;
holding past 1 second starts auto-repeating every 50ms until released
(standard spinner-control behavior), with a `window`-level
`pointerup`/`pointercancel` listener as a safety net so a release outside
the button - a real drag off the edge, not just a testing artifact - can't
leave the repeat running forever. Callers can optionally pass `min`/`max`
to clamp the value (unbounded by default); `ResourceMonitorPanel.jsx`
passes `min={0} max={100}` since its thresholds are percentages (unrelated
homonym - CPU/RAM/disk, section 21, not a Device at all) - a held repeat
that hits the clamp stops itself rather than continuing to fire identical
commits for as long as the button stays down. Each row also shows an
"Auto value" column next to "Current value" (both turn red on mismatch)
for controllable devices, and renames "Release to Auto" to "Auto", shown
only while a device is actually `MANUAL`.

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
Routing key shape: `<domain>.<entityId>.<eventType>` — today only
`device.<deviceId>.updated` exists (published by `dualDevicesModel.ts` —
see below). No `<resource>` segment anymore (section 30, 2026-07-28 - a
Device is atomic, one value, nothing left to name). `node.<id>.heartbeat`
and `system.mode.changed` are reserved shapes for later, not implemented
yet.

**Envelope** (JSON body of every message): `{ domain, entityId, value,
mode, valueAuto, valueManual, timestamp, source }` — one flat shape for
every event type, deliberately not modeled per-event-type since nothing so
far needs it. No `resource` field (section 30).

**Publish side** (`apps/api/src/messaging.ts` + `dualDevicesModel.ts`):
every `setActive`/`setManualActive`/`release` call ends by publishing the
device's new effective state and refreshing a Redis cache key,
`state:{deviceId}` → `{ value, mode, valueAuto, valueManual, updatedAt,
source }` (no `:{resource}` suffix, section 30). This is a **separate key
from `dvm:*`** (section 6) —
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
  exposes `useDeviceLiveState(deviceId)` (flat `{value, mode, valueAuto,
  valueManual, timestamp}` overlay, no resource sub-key - section 30) and
  `useLiveConnectionStatus()` (for the small `LiveBadge` shown on the Device
  Detail, Dev Simulator, and Live Events pages). Device Detail/Dev Simulator
  patch live value/mode over whatever the initial REST `GET /devices/:id`
  returned, without touching the Dev Simulator's in-progress draft inputs.
  `views/logs/LiveEvents.jsx` (`/live-events`, moved into the Logs nav group
  - section 29) is a raw feed of every message the socket receives, newest
  first, with domain/entity/mode/source filters + free-text search (client-
  side over the buffer) and a user-picked buffer size (100/200/500/1000,
  section 29/30) - superseded the earlier fixed `MAX_EVENTS = 200` constant
  this note originally flagged as a placeholder.
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
  discriminator (e.g. `resource-monitor`, `heartbeat-control`) selecting
  which control-loop function `apps/orchestrator` runs for it —
  `processRegistry` (a `Map<kind, runner>`, `src/processRegistry.ts`),
  populated by built-ins in `src/server.ts`'s `registerBuiltinProcessKinds()`
  and by a target project's own process plugins (`src/processPlugins.ts`,
  section 31's extension points) - not a fixed object literal any more.
  `config` is loose jsonb like `devices.capabilities` — shape depends on
  `kind`.
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

**Temperature Control / Temperature Safety Monitor - moved to
nexus-edge-smart-house (AGENTS_TO_DO.md 2026-07-29 "chistiy proekt" decision).**
This repo's own `apps/orchestrator` no longer registers these kinds - the
seed migrations below are still present in this repo's history (gated
behind `SEED_DEMO_FIXTURES`, section 31) but the process CODE itself now
lives as `nexus-edge-smart-house/plugins/temperature-control/process.ts`,
the first real worked example of the process-plugin extension point.
Kept below (paths updated in-place where it matters) since the
*patterns* it illustrates - `sensorDeviceId`/`heaterDeviceId`/
`coolerDeviceId` role config, the on→off edge tracked in an in-memory
`Map`, the independent-safety-monitor shape, `linkedProcessIds` removal,
WEM producer wiring - are still exactly how a real process plugin looks
and behaves, just no longer bundled into this repo's own orchestrator by
default.

**The two seeded processes** (`apps/api/migrations/
..._seed-temperature-control-processes.ts`), group "Temperature Control".
Originally both against one bundled `example-virtual-sensor-01` device
(`Temperature`/`Heater`/`Cooler` as its three "resources"); since the
2026-07-28 Device/Node correction (section 30) each is a separate atomic
Device on one Node (`example-thermal-node-01`:
`example-temperature-01`/`example-heater-01`/`example-cooler-01`), and
`process.config`'s `sensorDeviceId`/`heaterDeviceId`/`coolerDeviceId`
(migration `..._add-device-roles-to-temperature-processes.ts`) is the role
→ deviceId mapping both processes below now read instead of a single
`process.device_id`:

1. **Temperature Control** (`controllable`, `ON`/`OFF`) — every tick while
   `on`: reads the sensor device's value, writes the heater/cooler devices
   via `PUT /devices/:id/auto` (`setActive` — the *first* real caller of
   that endpoint, dormant since the Dual Devices Model shipped).
   `Cooler = temperature > max`, `Heater = temperature < min`, written
   every tick unconditionally (matches `/auto`'s own documented intent —
   "the orchestrator keeps updating `valueAuto` in the background" — this
   is genuinely that background computation, not something to debounce).
   While `off`: does nothing further, **except once, exactly on the
   on→off transition** (tracked in an in-memory `Map` in
   `nexus-edge-smart-house/plugins/temperature-control/process.ts` — resets
   on restart, which is fine, nothing here needs to survive one), where it
   forces both actuators off — confirmed live: pushed temperature above
   `max` (`Cooler` turned on), flipped the process `OFF` (`Cooler` forced
   back to `false`), flipped back `ON`.
2. **Temperature Safety Monitor** (`permanent`, no actions) — independent
   of process 1, deliberately configured with a **wider** min/max than the
   controller (confirmed: independent values by design, a permanent
   monitor may have wider critical margins than the controller it watches,
   not a duplicate of the same numbers) — every tick: reads the three
   devices' values directly (the live EdgeX-reported values,
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
Simulator uses — for `min`/`max` writing to the process's own config, not
a device; current temperature in large type, read from the sensor device;
big Cooler/Heater indicators, each reading its own device live, colored
only while active). Live `status`/
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

## 28. Heartbeating Control

The platform's own watchdog - detects a process whose orchestrator runner
has stopped ticking (not just a domain-level failure like Active Zummer's
alarm conditions, but the process itself going silent) and escalates
through the same WEM/`message_levels` pipeline every other alarm already
uses. Built after an explicit discussion with the user distinguishing
"not yet built" (this, and its planned siblings - command-path auth,
Redis/EdgeX reconciliation) from "wrong at the root" (nothing found -
see AGENTS_TO_DO.md's refactoring notes) - heartbeating was already on the
user's own roadmap, pulled forward as a real design/build pass.

### Config vs runtime split

Each entity (`processes`, `devices`, `nodes` - all three tables) has its
own `heartbeat_control` jsonb column:
```ts
{ stoppable: boolean,
  warning: { numberSkippedTicks: number, level: number } | null,
  error:   { numberSkippedTicks: number, level: number } | null }
```
Deliberately **not** a separate cross-entity table - confirmed directly
with the user ("вони належать їм і будуть розширювати для іншого
функціоналу"): this column belongs to each entity and is expected to grow
with more heartbeat-related fields later, same loose-jsonb convention
already used for `processes.config`/`devices.capabilities`. `stoppable`
is system-set at seed time only - never accepted by the PATCH endpoint
below, regardless of what a client sends. `level` refers to the existing
`message_levels` warning/error rows (1-4, section 22) - a stale entity is
just another WEM producer into the pipeline Active Zummer already
consumes, no new alerting mechanism.

Live/runtime state is Redis, not Postgres (confirmed with the user:
"поточний параметр в пам'яті") - `apps/api/src/heartbeatControl.ts`:
- `heartbeat:{type}:{id}:lastSeen` - a plain last-write-wins timestamp,
  **not** a TTL-expiring key. An earlier draft of this design (chat
  discussion before the user's own detailed written spec) proposed
  passive TTL-expiry detection ("free" staleness via Redis expiration,
  no watchdog needed) - dropped once the actual spec defined thresholds
  in *number of skipped ticks*: a single fixed TTL can't represent both a
  short warning window and a much longer error window for the same key at
  once, so detection has to actively compare "now minus last-seen" against
  each entity's own configured thresholds instead (see below).
- `heartbeat:{type}:{id}:stopped` - whether monitoring is currently
  paused. Only ever settable `true` for a `stoppable` entity - enforced
  server-side (`NotStoppableError` -> 400), not just a disabled UI switch.

### API (`apps/api/src/routes/heartbeatControls.ts`)

One mixed list and one update path spanning all three entity types,
per the user's own explicit direction ("Екшин збереження приймає
параметри type і зберігає зміни у відповідну таблицю однаково незалежно
від ентіті"):
- `GET /heartbeat-controls` - every process+device+node merged into one
  array (`{type, id, name, heartbeatControl, stopped, lastSeenAt}`),
  sorted by name.
- `PATCH /heartbeat-controls/:type/:id` - body `{warning, error}` only
  (never `stoppable`).
- `PUT /heartbeat-controls/:type/:id/stopped` - body `{stopped}`, the
  runtime pause/resume above.

`GET /processes` also carries `heartbeat_control` (config) plus
`heartbeatStopped`/`heartbeatLastSeenAt` (live) directly on each process
row - `apps/orchestrator`'s watchdog runner gets everything it needs from
the one `GET /processes` call it already makes every tick, no second
endpoint required. `POST /processes/heartbeat` (body `{processIds}`) is
the batched touch - see below for why batched.

### Scope: processes now, devices/nodes structure-only

Confirmed with the user: real staleness *detection* is wired up for
processes only in this first pass - they already have a natural 1s tick
driver (the orchestrator's own loop); devices/nodes have no heartbeat
producer of any kind yet (a pre-existing gap, confirmed while designing
this - `nodes.last_heartbeat_at`/`health` are stub columns with no writer
anywhere). Devices/nodes still get the full config column and appear in
the combined UI list/edit form (so the shape is exercised and stable),
just never actually evaluated for staleness - `apps/orchestrator`'s
watchdog only ever reads `GET /processes`, which never returns devices or
nodes at all, so this scope boundary falls out naturally rather than
needing an explicit filter.

### Orchestrator (`apps/orchestrator/src/processes/heartbeatControl.ts`)

The "Heartbeating Control" process kind, on the shared 1s tick like every
other kind - no second timer loop. Each tick: reads the same
`GET /processes` fleet snapshot, and for every process with a non-null
`warning`/`error` config (and not currently `stopped`), computes
`skippedTicks = floor((now - lastSeenAt) / TICK_INTERVAL_MS)` and
compares against that process's own configured thresholds - error takes
precedence over warning (same mutual-exclusivity convention as
`resourceMonitor.ts`'s critical/warning split). `TICK_INTERVAL_MS` lives
in its own dependency-free module (`tickInterval.ts`), not `index.ts`
itself, to avoid a circular import (same reasoning as `apps/api`'s
`processStateEvents.ts`).

**WEM entries are raised under "Heartbeating Control"'s own `process_id`,
not the stale entity's** - confirmed with the user before building this,
for two concrete reasons: `process_messages` has no FK for devices/nodes
at all, and a process whose own runner is genuinely broken can't reliably
report its own staleness (detecting that is the entire point of an
independent watchdog). Practical consequence worth remembering: a stale
Resource Monitor shows its red/yellow highlight on **Heartbeating
Control's** row, not Resource Monitor's own row.

Also sets `critical`/`warning` booleans on itself (row highlight),
alongside the WEM entries (list/Dashboard) - missed on the first pass,
caught immediately when live-tested against `resourceMonitor.ts`'s own
established pattern of setting both, not just one.

Batched heartbeat touch, not one HTTP call per process per second:
`index.ts`'s `tick()` collects every process id whose runner completed
*without throwing* this tick into one array, and calls
`apiClient.touchHeartbeats(ids)` once at the end - a single
`POST /processes/heartbeat`, pipelined into Redis server-side
(`heartbeatControl.touchHeartbeats`), not N round trips.

### "Heartbeating control test" process

A dummy **permanent** process (deliberately **not** controllable) with its
own bespoke internal flag, `heartbeatTestSimulateFailure` - Redis-backed
(`heartbeat:test:{id}:simulateFailure` in `heartbeatControl.ts`), toggled
from a switch *inside* its own expandable detail panel, per the user's
own spec ("В розгортці процесу є тільки один свічер"). An earlier draft
of this got both of those wrong: it made the process `controllable` and
reused the generic `ON`/`OFF` status/action mechanism (reasoning: reuse
proven infrastructure instead of a bespoke one) - the user caught this
live on two counts: (1) the switch belongs inside the detail panel, not
promoted to the row as a side effect of being controllable, and (2)
`status` is a deliberately non-urgent, timer-only broadcast field
(section 24), which visibly lagged for exactly this "flip it and watch
the effect immediately" use case. Fixed by staying `permanent` (no
actions at all) and giving the process its own dedicated, instantly-
effective toggle - a `PUT /processes/:id/heartbeat-test-failure` endpoint
writing straight to Redis, read back via `GET /processes`'
`heartbeatTestSimulateFailure` field (present on every process record,
same as `heartbeatStopped`), with `HeartbeatControlTestPanel.jsx` managing
the switch's visual state **optimistically** in local component state -
it flips the instant the user clicks, never waiting on any broadcast or
reload to catch up, which is what actually fixes the lag (not merely
moving the switch's location).

Its runner (`heartbeatControlTest.ts`) throws while the flag is `true`.
This is a *second*, independent test lever alongside the general
`stopped` mechanism above - confirmed the two don't conflict:
- Toggling the internal flag simulates a genuinely dead heartbeat (the
  runner throws, `tick()` excludes it from the touch batch, "Heartbeating
  Control" naturally notices and escalates warning -> error) - tests the
  *detection/escalation* path end-to-end, through the real failure
  mechanism, not a synthetic bypass.
- Toggling its separate `stopped` flag (from the combined list, since
  it's the one entity seeded `stoppable: true`) pauses monitoring of it
  regardless of whether it's actually ticking - tests that *that*
  mechanism correctly suppresses alerts.

### UI (`apps/ui/src/views/processes/`)

`HeartbeatControlPanel.jsx` - the "Heartbeating Control" process's own
expandable detail panel (per the user's own spec: "в розгорнутій
компоненті процесу", not a separate page), reusing the existing
pagination/search toolkit (section 11) even though the underlying data
spans three REST resources merged server-side into one list. Type filter
(All/Processes/Devices/Nodes) + name search + `ResetFiltersButton`, a
table with an Edit (gear icon, matching the existing per-process
Settings-popup convention) opening `HeartbeatEditModal.jsx` (two threshold
rows, warning/error, each a ticks-count input + a level select that
includes "Off (not monitored)" as `null`), and a `Switch` per row wired to
the runtime `stopped` toggle - disabled entirely for a non-`stoppable`
entity (enforced both here and server-side).

`HeartbeatControlTestPanel.jsx` - its own switch (see above), plus the
explanation of what it does.

Two real bugs caught before shipping, both from live-testing rather than
lint/type errors:
1. The test process was originally seeded `permanent` with no runner
   registered in `RUNNERS` at all, meaning its heartbeat would *never* be
   touched by anything - it would show as maximally stale from boot
   instead of behaving normally until deliberately toggled off. First fix
   (superseded by the correction above) made it `controllable`; the
   final shape keeps it `permanent` with a runner that reads the bespoke
   flag instead.
2. That first fix's reuse of the generic ON/OFF mechanism both misplaced
   the switch (row-level, not inside the panel) and visibly lagged
   (non-urgent broadcast field) - caught directly by the user, fixed as
   described above.

Verified live end-to-end, after the correction: the panel's switch
flips instantly on click (no lag), and toggling it produced a
warning-level WEM under "Heartbeating Control" after 3 skipped ticks,
escalated to error-level (with `critical` row highlight) after 10, then
auto-resolved the instant it was switched back - all through the real
orchestrator tick loop, not simulated. The independent `stopped` toggle
was verified to correctly suppress alerts even while the test process's
own heartbeat stayed genuinely dead, confirming the two mechanisms don't
interfere with each other. Console clean throughout; state reset to
defaults afterward.

## 29. Logs page (new nav group, historical browser over the three log tables)

A read-only historical browser over the three append-only log tables that
already existed but had no query surface (`device_command_logs`,
`sensor_reading_logs` - section 22) plus `process_messages` (section 22/25,
which already had one via the notification center). New top-level sidebar
group **Logs**, containing `Live Events` (moved out of the Devices group -
same component, relocated to `apps/ui/src/views/logs/`) and the new
**Logs** page itself.

> **Renamed by the 2026-07-28 Device/Node correction (section 30):**
> `device_command_logs` → `log_command`, `sensor_reading_logs` →
> `log_device`, `process_messages` → `log_messages`; `deviceCommandLog.ts`
> → `commandLog.ts`, `sensorReadingLog.ts` → `deviceLog.ts`; routes moved
> to `GET /logs/commands` / `GET /logs/devices`; both tables also lost
> their `resource` column/filter (a Device is now atomic, so
> "which resource on this device" no longer exists - search is by device
> name only). `DeviceCommandLogsTab.jsx` → `CommandLogsTab.jsx`,
> `SensorReadingLogsTab.jsx` → `DeviceLogsTab.jsx`. The rest of this
> section otherwise still describes the current shape (filters, pagination,
> column layout) - only the names above changed.

### Backend

- `apps/api/src/commandLog.ts` / `deviceLog.ts` each gained a `list*Logs`
  function (device-name-search/date-range filters, paginated,
  `LEFT JOIN devices` for a display name - `device_id` is nullable,
  `ON DELETE SET NULL`, so a deleted device's history still shows with
  `device_name: null`). Same shape as `processMessages.listProcessMessages`.
- `apps/api/src/routes/logs.ts` - `GET /logs/commands` and
  `GET /logs/devices`. No third route for processes: the **processes tab
  reuses the existing `GET /log-messages`** (`scope: 'all'`) rather than
  duplicating a nearly-identical endpoint - `processMessages.ts` gained
  optional `from`/`to` ISO-timestamp bounds and `group_name` (joined from
  `process_groups`) for this purpose; the notification center popup
  (section 25) never sets `from`/`to` and is unaffected.
- New migration adds a `created_at` index to `process_messages`/
  `log_messages` (the other two log tables already had one from their own
  creation migrations) - this page is the first consumer to filter/sort
  that table by date range.

### Frontend

- `apps/ui/src/hooks/useServerPaginatedList.js` - the hand-rolled
  page/pageSize/items/total/loading/error/reload state
  `NotificationCenterModal.jsx` already used for its one server-paginated
  list, factored out since this page needed the identical pattern three
  more times. Takes `(fetcher, deps, {pageSize})`; resets to page 1
  whenever `deps` (the caller's own filter values) changes, same as every
  filter setter elsewhere in this app already does by hand. Distinct from
  `usePagination.js` (client-side slicing of an already-fetched array,
  section 12) - this one owns the actual network round trip.
- `apps/ui/src/components/table/DateRangeFilter.jsx` - two native
  `<input type="datetime-local">` fields (From/To). No date-range picker
  library exists in this app and this project's low-footprint/Raspberry Pi
  philosophy argues against adding one just for this - confirmed with the
  user (`AskUserQuestion`) rather than assumed.
  `utils/format.js`'s new `localDateTimeToIso()` converts the local-time
  input value to a UTC ISO string for the API.
- `apps/ui/src/views/logs/LogsList.jsx` - `CTabs`/`CTabList` (not
  `CTabContent`/`CTabPanel`, same reasoning as the Processes page, section
  23 - an inactive tab shouldn't keep its own fetch/pagination state
  mounted), three tabs: `CommandLogsTab.jsx`, `DeviceLogsTab.jsx`,
  `ProcessMessageLogsTab.jsx`. Devices/processes lists are fetched once at
  the page level and passed down for each tab's own selector.
- Each tab: its own relevant selectors (device/action for commands; device
  for devices; type/process for processes) + text search +
  `DateRangeFilter` + reload + `ResetFiltersButton`, then a plain table +
  `TablePagination` (page sizes `[20, 50, 100]`, matching the notification
  center's own append-only-log convention rather than the client-side
  toolkit's `[10, 25, 50]`, section 11).
- Columns deliberately differ per tab rather than forcing a uniform set -
  confirmed with the user that the "Group" column only makes sense for the
  processes tab (its Process Group) and that a per-row `activeSwitcher`
  toggle from the original request was a copy-paste mistake, not a real
  requirement (skipped entirely). The processes tab's rightmost column
  shows read/unread + who-dismissed-and-when (reusing the notification
  center's own avatar rendering, `utils/format.js`'s `userInitials()` now
  shared between both) purely as **information**, not an action - this tab
  is an audit trail, not a second inbox; dismissing a message still only
  happens from the header notification center (section 25).

### Deferred - freshness ("OK"/"ERROR") status column

The original request described a `status` column for the commands/devices
tabs meaning "was this value refreshed within its expected interval" (OK)
vs "overdue" (ERROR) - conceptually a per-device staleness check, similar
in spirit to Heartbeating Control (section 28) but for individual devices
rather than whole processes/nodes. **Not implemented** - there is no
existing "expected update interval" concept per device to check against,
and the user explicitly agreed to skip it for now rather than force a
design under this task's scope, asking only that it be written down as
future work. Whoever picks this up next should look at whether it
belongs as a new device config field (`devices.capabilities`?) or as its
own table, and whether Heartbeating Control's ticks-based model is
reusable here or genuinely a different shape (a device reading interval
isn't tied to the orchestrator's own tick loop the way a process's is).
Note also that after the 2026-07-28 correction (section 30), `log_device`
is no longer written from raw pings at all - see section 30 - so this
deferred feature would need to be rethought against whatever future
logging process ends up populating that table.

## 30. Device/Node model correction (Devices no longer bundle "resources")

A fundamental modeling error, present since the project's very first
device-related commits, was corrected on 2026-07-28: what this codebase
called a "Device" (in Postgres, `devices` table) was actually a **Node** -
a controller (e.g. an STM32) that has one or more **atomic** physical
devices attached to it (a button, a joystick, a relay, a sensor). What the
codebase called a "Resource" (a named value living under a Device, e.g.
`devices.capabilities.resources.Level`) was actually the **Device**
itself. A Device has exactly one interface/protocol and one value - it is
never a bundle. A physical assembly like an I2C joystick-with-
microcontroller-on-a-board still counts as one Device if the software only
ever addresses it as a single data stream; four separate buttons wired
independently are four separate Devices.

This was not a rename - the two concepts nest the opposite way from how
they were originally implemented (a "Device" used to contain "Resources";
now a **Node** contains **Devices**), so the correction touched the
Postgres schema, Redis key shapes, REST routes, RabbitMQ routing keys,
WebSocket envelopes, the EdgeX device-profile layer, the orchestrator, and
the UI. It was executed as six phases, each with its own live
verification (curl, psql, browser, raw WebSocket scripts) before moving
to the next - no phase was taken on faith.

### The corrected model

- **Device** = atomic physical device. One interface/protocol, one value.
  Examples: a button, a joystick, a relay, a single-channel sensor, a
  display, a microcontroller running its own firmware. `devices` table,
  now with a `node_id` foreign key (nullable - a Device can attach
  directly, see below) instead of the old flat `capabilities.resources`
  map; `devices.capabilities` is now a flat shape
  (`{edgexResource?, readOnly?, min?, max?, step?}` - see section 7) with
  no "resource" dimension at all.
- **Node** = a controller multiple atomic Devices attach to (e.g. an
  STM32). New `nodes` table (`id`, `name`, `forbidden` jsonb - the
  Model State Validator's forbidden-state rules, moved here from
  per-Device since a rule like "heater and cooler can't both be on" is a
  property of the physical assembly, not of either Device alone -
  section 7). A Device's `node_id` is nullable: Devices and Nodes can both
  connect to the computer directly or through each other, over multiple
  interfaces/drivers simultaneously, via EdgeX Foundry as the common
  ingestion gate ("EdgeX Gate") - the Node is an organizational/safety
  grouping, not a required transport hop.
- **"Resource" is eliminated** as a concept everywhere in the stack. It
  never referred to a real independent thing - it was this codebase's
  incorrect name for what should have been a whole separate Device.
- The Virtual Node Runtime / simulator (section 5) simulates the entire
  connected hardware network, matching this model directly: each virtual
  EdgeX device already corresponded 1:1 with a single value even before
  the correction (`backendFor()` resolves physical/virtual per EdgeX
  device) - this was the concrete evidence that the bundling was
  architecturally wrong, not merely a naming/cosmetics issue.
- Network topology is a star: one Device uses exactly one transport at a
  time. This correction is a pure data-model change - no transport/
  networking-layer code changed.

### Log tables renamed and re-scoped

Three append-only log tables (section 22/29), renamed to match the
corrected model and to drop the now-nonexistent `resource` dimension:

| Old name               | New name      | Change                          |
|-------------------------|---------------|----------------------------------|
| `sensor_reading_logs`   | `log_device`  | dropped `resource` column        |
| `device_command_logs`   | `log_command` | dropped `resource` column        |
| `process_messages`      | `log_messages`| name only (column shape unchanged) |

Migration `1690000000032_rename-log-tables.ts` renamed each table plus
every dependent sequence/index/constraint via explicit raw SQL (Postgres's
`ALTER TABLE ... RENAME` does **not** cascade to these) - the old/new
names for each were captured from `pg_indexes`/`pg_constraint` directly
before writing the migration, and the full `up`/`down` round trip was
verified live with zero errors and zero data loss.

**`log_device` is no longer written from device pings at all.** Before
this correction, every sensor-reading tick was logged unconditionally.
The user's explicit instruction was to remove this behavior completely
now, rather than build an immediate replacement: `dualDevicesModel.ts`'s
`publishReading()` no longer calls into any log-writing function. A
future **configurable process** (one or several, per rule/schedule - not
yet designed) will be added later to populate `log_device` selectively.
Until then the table exists (renamed, schema-correct) but nothing writes
rows into it via this path; `log_command` is unaffected and still logs
every write, same as before.

### What changed, by layer

- **`apps/device-service` (Go, EdgeX profiles)** - the bundled
  `NexusEdge-Example-Virtual.yaml` profile (one EdgeX device, four
  deviceResources: Temperature/Heater/Cooler/Switch) split into four
  single-resource profiles (`NexusEdge-Example-{Temperature,Heater,
  Cooler,Switch}.yaml`) and four separate `deviceList` entries in
  `res/devices/example-devices.yaml`, each with its own
  `protocols.backend.mode`. The 10s Temperature autoEvent moved to the
  Temperature entry only.
- **Postgres** - `nodes` table added (`forbidden` jsonb); `processes`
  gained `node_id`; `devices.capabilities` flattened (light-regulator-01,
  active-buzzer-01 rewritten in place); the old bundled
  `example-virtual-sensor-01` row replaced by one `example-thermal-node`
  Node row + four Device rows; `processes.config` for the
  temperature-control/temperature-monitor kinds gained explicit
  `sensorDeviceId`/`heaterDeviceId`/`coolerDeviceId` role mappings (a
  process addresses specific Devices by id now, not "the bundled device's
  named resources"); the three log tables renamed as above. See migrations
  `1690000000028`-`1690000000033`.
- **`apps/api`** - `edgex.ts`'s `readResource`/`writeResource` →
  `readValue`/`writeValue` (`resource` param → `commandName`);
  `validator.ts` rewritten around `{device, equals}` pairs instead of
  `{resource, equals}`, evaluated against a Node's `forbidden` list
  instead of a Device's; `dualDevicesModel.ts` rewritten so every function
  and every Redis key (`dvm:{deviceId}:...`, `state:{deviceId}`) is keyed
  by Device id alone (section 6 already reflects this); `commandLog.ts`/
  `deviceLog.ts` renamed from `deviceCommandLog.ts`/`sensorReadingLog.ts`;
  `routes/devices.ts` rewritten around single-value Devices (`GET
  /devices/:id` now returns `value`/`valueType`/`units`/`dualState`
  directly, no `resources` map) with Node-scoped `checkForbidden()`;
  `messaging.ts`'s `DeviceEventEnvelope` dropped its `resource` field,
  RabbitMQ routing key format changed from
  `device.<id>.<resource>.updated` to `device.<id>.updated`.
- **`apps/messaging-gateway`** - not originally in scope for this
  correction but necessarily touched: its Redis state-snapshot reader and
  WS fan-out were both coupled to the old `resource`-keyed shapes
  (`redis.ts`'s `CachedState`, `server.ts`'s envelope construction) and
  had to be updated to match `apps/api`'s new key/envelope formats.
- **`apps/orchestrator`** - `apiClient.ts`'s `DeviceRecord` is now
  `{id, value}` (was `{id, resources}`); `setResourceAuto(deviceId,
  resource, value)` → `setDeviceAuto(deviceId, value)`;
  `temperatureControl.ts`/`temperatureMonitor.ts` read their target
  Devices via the new `process.config.sensorDeviceId`/`heaterDeviceId`/
  `coolerDeviceId` role mapping instead of one bundled device's named
  resources; `activeBuzzer.ts` calls `setDeviceAuto` directly.
- **`apps/ui`** - `DeviceDetail.jsx` and `DevSimulator.jsx` rewritten
  around a single value per Device (`DevSimulator.jsx`'s per-device
  resource table collapsed to one row per Device via a new
  `DeviceSimulatorRow` component); `TemperatureProcessPanel.jsx` now makes
  three separate `useDeviceLiveState`/`getDevice` calls (one per role);
  `ActiveBuzzerPanel.jsx` reads `live.value`/`device.value` directly (was
  `live.Buzzer`/`device.resources?.Buzzer?.value`); Logs page tabs and
  Live Events (section 29) lost their Resource filters/columns entirely.
- **`devices/` design-time layout (section 7)** - first real use of the
  node-attached shape,
  `devices/nodes/example-thermal-node/{node.yaml,safety.yaml,devices/
  {temperature,heater,cooler,switch}/}`, each device directory following
  the same `contract.schema.ts`/`edgex-device-profile.yaml`/`safety.yaml`/
  `config/default-state.yaml`/`docs/README.md`/`tests/README.md`/
  `CHANGELOG.md` template already established by
  `devices/standalone/light-regulator`. New convention established here
  (no prior precedent existed): a node-attached Device's own `safety.yaml`
  is always empty - a cross-device forbidden-state rule (e.g. "heater and
  cooler can't both be on") is declared once, on the **Node's**
  `safety.yaml`/`nodes.forbidden`, not duplicated onto each Device
  involved.

### Bugs found and fixed along the way (not part of the original scope, but caused/exposed by this work)

- EdgeX core-command always returns `Bool`-typed readings as the literal
  string `"false"`/`"true"`, never a JSON boolean - `normalizeReading()`
  in `edgex.ts` previously only normalized numeric types; extended to also
  convert Bool strings, otherwise a freshly-read (never
  Dual-Devices-Model-written) Bool Device's `currentValue === true` checks
  silently always failed. Pre-existing bug, unrelated to this correction
  except that rewriting `edgex.ts` surfaced it.
- `dualDevicesModel.ts`'s `publishReading()` still called `logReading()`
  after the mechanical "drop the resource parameter" pass (an oversight,
  caught at the start of the phase touching the orchestrator) - the user's
  instruction was to remove the call entirely, not just adapt its
  signature; fixed and verified via a before/after `log_device` row-count
  check across a `/simulate` call.
- `GET /devices/:id` initially returned only a bare `value` (an oversight
  from the same pass, caught one phase later while updating the UI),
  losing the `valueType`/`units` metadata the UI needs to choose
  Bool-checkbox vs numeric-stepper rendering and to display units; fixed
  by returning `value`/`valueType`/`units` as sibling fields.
- `LiveEvents.jsx` (section 29) - not in this correction's original file
  list, since it was built earlier in the same session after the
  correction's own plan had already been written - broke silently (its
  Resource filter/column always showed empty) once the WS envelope
  dropped `resource`; caught live in the browser and fixed by removing the
  Resource filter/column entirely.

## 31. Extension points (target projects add DNPs/commands/UI without forking)

A target project (e.g. `../nexus-edge-smart-house`, sibling repo, the
reference example - see `docs/CREATING_A_TARGET_PROJECT.md` for the
manual bootstrap checklist) adds its own private DNPs, command routes,
and device UI without modifying or forking this repo. Built-in
(Library) DNPs use the exact same mechanism a private plugin would - no
special-casing "official" vs "private" anywhere below.

- **`apps/orchestrator`'s process-plugin loader** (`src/processPlugins.ts`,
  `loadProcessPlugins()`) - same runtime directory-scan pattern as
  `apiPlugins.ts` below: scans `EXTRA_PROCESS_PLUGINS_DIR` (env, a target
  project's own `plugins/`, mounted read-only) for any `process.ts` file,
  dynamic-imported directly (no build step, same Node 22 native
  TypeScript stripping). A file's default export is `(register, {
  apiClient, logger }) => void` - deliberately receiving its dependencies
  as plain function arguments rather than importing them from
  `@nexus-edge/orchestrator`, the same reason `apiPlugins.ts`'s Fastify
  plugins receive `app` as an argument: it sidesteps Node module
  resolution ever needing to find that package from an arbitrary mounted
  file path. `register(kind, runner)` forwards straight into
  `processRegistry` (`src/processRegistry.ts` - `register(kind, runner)`/
  `get(kind)`, a `Map` under a small API), the same one
  `registerBuiltinProcessKinds()` (`src/server.ts`) populates for the
  built-in kinds - `loadProcessPlugins()` runs right after it, inside
  `startOrchestrator()`. `nexus-edge-smart-house/plugins/
  temperature-control/process.ts` is the first real worked example
  (moved out of this repo's own orchestrator entirely - see this
  section's note in section 10). `processRegistry` is still exported via
  `package.json` (`./processRegistry`, a real `file:` npm dependency
  would work too, for a target project wanting tighter integration) but
  the plugin loader above is the recommended path - it needs no
  npm package/Dockerfile of the target project's own, matching every
  other extension point's low ceremony.
- **`apps/ui`'s `deviceTypeRegistry`** (`src/deviceTypeRegistry.js`) -
  plain objects `deviceControls`/`deviceSimulators`, written to via
  `registerControl`/`registerSimulator`, read via bracket access
  (`deviceControls[type]`) rather than a getter - `react-hooks/
  static-components` flags a component obtained through a function call
  as "created during render" even when the call is a pure lookup.
  Built-ins register from `builtinDeviceTypes.js` (imported once,
  side-effect, from `index.jsx`); a target project's own types register
  the same way from its own `plugins/*/ui/register.js` - see the UI
  point below for how that file gets bundled in at all.
- **`apps/api`'s command-API plugin loader** (`src/apiPlugins.ts`,
  `loadApiPlugins()`) - recursively scans `config.apiPlugins.
  builtinDevicesDir` (`/workspace/devices`, Library - `devices/` is
  copied into the runtime image specifically for this, see the
  Dockerfile) and, if set, `config.apiPlugins.extraDir` (env
  `EXTRA_API_PLUGINS_DIR`, a target project's own `plugins/`, mounted
  read-only), for any `api.ts` file. Each one is dynamic-imported
  directly - **Node 22 strips TypeScript types natively, no build step
  needed** (verified directly: `node hello.ts` and a dynamic `import()`
  of a raw `.ts` file both work out of the box in the `node:22-alpine`
  image this repo uses). A file's default export must be a plain Fastify
  plugin (`export default async function(app) {...}`), registered via
  `app.register()` - same shape every `routes/*.ts` in this app already
  exports. Only needed when the generic Device API (write/auto/simulate)
  and Process API aren't enough; nothing in the Library needs one today.
- **`apps/device-service`'s `EXTRA_RES_DIR`**
  (`internal/extrares/extrares.go`, `Merge()`) - the EdgeX SDK's
  `Device.ProfilesDir`/`DevicesDir` config keys are each exactly one
  directory, read once inside `startup.Bootstrap` with no exposed hook
  to add a second source (`internal/provision` isn't importable outside
  the SDK module - confirmed by reading the SDK source directly, not
  assumed). `Merge()` symlinks `*.yaml`/`*.yml` from
  `$EXTRA_RES_DIR/profiles`/`$EXTRA_RES_DIR/devices` into this service's
  own `./res/profiles`/`./res/devices` **before** `startup.Bootstrap`
  runs - the only integration point available without forking the SDK.
  Fails loudly on a filename collision rather than silently shadowing a
  built-in file. No-op if `EXTRA_RES_DIR` is unset.
- **`apps/ui`'s build-time plugin glob** (`src/pluginDeviceTypes.js`) -
  `import.meta.glob('plugins/*/ui/register.js', { eager: true })`. Vite
  bundles the UI into one static file at build time, so this is the one
  extension point that genuinely cannot be runtime-loaded the way the
  three above are - `import.meta.glob` is Vite's own build-time
  equivalent of a directory scan. Resolves through a new `vite.config.
  mjs` alias, `plugins/` -> repo-root `plugins/` (same convention as the
  existing `devices/` alias) - verified live with a throwaway spike
  (temporary alias + glob + marker file, a real `vite build`, grepped
  the output bundle for the marker) that `import.meta.glob` resolves
  through a custom alias the same way a static import already does, not
  assumed. A target project's own `plugins/<name>/ui/register.js` is a
  plain side-effect file (same style as `builtinDeviceTypes.js`),
  importing `deviceControls`/`deviceSimulators` via a path that only
  resolves correctly inside the merged build-time tree a target
  project's **own** `apps/ui/Dockerfile` assembles (this repo's own ui
  Dockerfile can't be reused unmodified the way api/orchestrator/
  device-service's can - see `docs/CREATING_A_TARGET_PROJECT.md` section
  6 for the exact Dockerfile/build-context shape). `plugins/` is empty
  in this repo (reserved, section 2/4) - zero matches, so this is a
  no-op for this repo's own build.
- **Not designed yet**: a genuine Dashboard *widget* host (a standalone
  tile on the Dashboard page, not tied to one device's own page) -
  Dashboard is still tabs/entities (section 23), not a composable widget
  grid. The same `register.js`/glob mechanism will apply once one
  exists.
- **Deliberately not part of this list**: Postgres schema/seed data. A
  target project's own migrations are just its own separate SQL/
  node-pg-migrate run against the same database, independent of this
  repo's migration sequence - no extension point needed since nothing
  here gates it. (This repo's own migrations used to unconditionally
  seed demo/smoke-test fixtures into every target project - fixed
  2026-07-29, see `SEED_DEMO_FIXTURES` below.)
- **`SEED_DEMO_FIXTURES`** (env, `apps/api/migrations/
  1690000000034_gate-demo-fixtures.ts`) - unset/false (`.env.example`
  default, every target project) deletes `light-regulator-01`/
  `active-buzzer-01`+its process/`heartbeat-control-test` right after
  they're seeded; `true` (this repo's own local `.env`) leaves them.
  `temperature-control`/`temperature-monitor` are handled differently
  (migration `1690000000035`, unconditional, scoped to this repo's own
  `example-thermal-node-01` by `node_id` - **not** by `kind`, which
  would also match a target project's own same-kind process plugin, a
  real bug caught live building `nexus-edge-smart-house`'s temperature-
  control example) - their process CODE moved out of this repo entirely
  (section 10's note), so there is no runner left here to seed rows for
  even with the flag on.
- **`make new-project`** (`Makefile`, `scripts/new-project.sh`,
  `templates/target-project/`) - generates a new target project from
  the template (placeholders filled in: display name, a slug derived
  from the target folder's own name, `NEXUS_EDGE_SOURCE_PATH` computed
  relative to wherever it's generated, `NEXUS_EDGE_VERSION` from this
  repo's own `package.json`). Automates `docs/
  CREATING_A_TARGET_PROJECT.md` sections 1-4 (directory/git, both
  compose files, `.env`) - sections 5-7 (the extension points
  themselves) stay manual, since what goes there depends entirely on
  what's being built. Verified live end-to-end (generate, fix the
  inevitable port collision with an already-running project by hand,
  `make up-all`): a fresh project shows its own custom name in the UI
  and has exactly the two base system processes, zero devices.

## 32. Data Logger (`data-logger` process kind)

A permanent System process deciding what/when to write to `log_device`,
closing the gap the 2026-07-27 Device/Node correction (section 30) left
open on purpose: the old unconditional per-tick write from
`dualDevicesModel.publishReading` was removed outright, with a note that
"a future configurable process will decide what/when to log" - this is
that process. Built with Heartbeating Control (section 28) as the
explicit architectural template, confirmed with the user before starting.

Devices only, not Nodes - a Device is atomic (exactly one value, section
30), a Node has none to log. This is the one structural place Data
Logger's combined list differs from Heartbeating Control's three-way
processes+devices+nodes merge. Further narrowed to `readOnly` Devices
only (`listDataLoggerControls`'s `WHERE (capabilities->>'readOnly')::
boolean IS TRUE`, added after the user caught `active-buzzer-01` - a
writable actuator - showing up in the list): a device you command isn't
"providing data" the way a sensor's reading is, so a non-`readOnly`
Device is excluded from this list entirely, not merely shown disabled.

### Config vs runtime split

`devices.data_logger_control` jsonb column:
```ts
{ writeEnabled: boolean,
  periodSeconds: number | null,
  warning: { numberSkippedPeriods: number, level: number } | null,
  error:   { numberSkippedPeriods: number, level: number } | null }
```
`numberSkippedPeriods` counts overdue periods **of this device's own
`periodSeconds`**, not raw system ticks - a deliberate difference from
Heartbeating Control's `numberSkippedTicks`, confirmed with the user
after they connected it to how live values already carry a
timestamp in Redis (`state:{deviceId}`'s `updatedAt` -
`dualDevicesModel.ts`) - that key has no TTL though, so Data Logger
tracks its own last-write time independently (below) rather than reusing
it; "is the cached live value fresh" and "is the historical log current"
are different questions with different producers. `writeEnabled` is
never accepted verbatim from a client - forced `false` server-side
whenever `periodSeconds` is (or becomes) `null`
(`apps/api/src/dataLoggerControl.ts`'s `updateDataLoggerControl`/
`setWriteEnabled`), matching the user's own spec ("може бути порожнім -
свічер OFF+disable") without relying on the UI to enforce it.

The "Data Logger" process's own two global switches live in its
`processes.config` instead of a new dedicated table (there are exactly
two booleans, and they belong to this one process - same reasoning as
temperature-control keeping `min`/`max` on its own row):
```ts
{ errorWarningEnabled: boolean, tickLoggingEnabled: boolean }
```

Live/runtime state is Redis, same "plain last-write-wins timestamp, not
TTL" reasoning as Heartbeating Control's `lastSeen` (a threshold in
"skipped periods" can't be represented by one fixed TTL):
- `data-logger:{deviceId}:lastLoggedAt` - set by
  `apps/api/src/dataLoggerControl.ts`'s `touchLastLoggedAt`, called from
  `POST /devices/:id/log` right after a successful `log_device` write.

### API

- `GET /data-logger-controls` - every device, sorted by name
  (`{id, name, dataLoggerControl, lastLoggedAt}`).
- `PATCH /data-logger-controls/:deviceId` - body
  `{periodSeconds, warning, error}`.
- `PUT /data-logger-controls/:deviceId/write-enabled` - body
  `{writeEnabled}`; 400s (`NoPeriodConfiguredError`) if `periodSeconds`
  is `null` and the caller tries to enable it - enforced here, not just
  a disabled switch in the UI, same pattern as Heartbeating Control's
  `NotStoppableError`.
- `GET`/`PATCH /data-logger-controls/settings` - the process's own two
  global switches (registered before the `:deviceId` routes so
  `"settings"` is never matched as a device id).
- `POST /devices/:id/log` (`routes/devices.ts`) - reads the device's own
  current live value the same way `GET /devices/:id` does, writes it via
  the already-existing (previously unused) `deviceLog.logReading`, and
  touches `lastLoggedAt` in the same call. `apps/orchestrator` calls this
  once per due device per tick rather than duplicating the EdgeX read
  itself - it never talks to EdgeX/Postgres/Redis directly (section 4).

### Orchestrator (`apps/orchestrator/src/processes/dataLogger.ts`)

Every tick, for each device with `writeEnabled` and a `periodSeconds`:
1. **Tick-resolution guard**: if `periodSeconds` is at or below one tick
   and `tickLoggingEnabled` is `false`, the device is skipped entirely
   this tick - no write attempt, no staleness evaluation, deliberately
   silent (not itself a warning). This is the direct answer to the user
   recalling the old unconditional-write behavior producing "thousands of
   records": tick-resolution logging now requires an explicit, global,
   off-by-default opt-in, meant for a deliberately chosen few critical
   devices, not a blanket setting.
2. **Write if due**: compares elapsed time since `lastLoggedAt` (never
   logged = always due) against `periodSeconds`; if due, calls
   `POST /devices/:id/log` and treats `lastLoggedAt` as "now" for the
   next step - a healthy device that just logged successfully always
   evaluates as zero periods overdue immediately after, so routine
   logging never produces a spurious one-tick warning blip. A failed
   write (device unreachable etc.) leaves the old `lastLoggedAt`
   in place, so the overdue check below picks it up honestly.
3. **Overdue check** (only if `errorWarningEnabled`): skipped-periods
   count vs. `warning`/`error` thresholds, error taking precedence over
   warning - same mutual-exclusivity convention as
   `resourceMonitor.ts`/`heartbeatControl.ts`. Raised under the **Data
   Logger process's own id**, not the overdue device's - `log_messages`
   has no FK for devices at all, same reasoning as Heartbeating Control's
   watchdog-reports-under-its-own-id convention (section 28).

Defaults seeded (migration `..._add-data-logger`): `warning` at 1 skipped
period, `error` at 2 - the user's own explicit numbers, given directly
rather than inferred.

### UI

`apps/ui/src/views/processes/DataLoggerPanel.jsx` - lives entirely
inside "Data Logger"'s own expandable process row (no separate page,
same convention as every other system process's panel), two `Switch`
toggles at the top for the global settings, then the combined device
list below reusing the standard filter/search/pagination toolkit
(section 11): Name/Period/Warning/Error columns, a gear `IconButton`
opening `DataLoggerEditModal.jsx` (period input - placeholder `60.00`,
step `0.01` - plus the same paired `ThresholdRow` shape as
`HeartbeatEditModal.jsx`, just `numberSkippedPeriods` instead of
`numberSkippedTicks`) and a write/ignore `Switch`, disabled whenever
`periodSeconds` is `null`.

### Verified live

Not just config wiring - a real fault-injection round trip: configured
`light-regulator-01` at a 3s period, confirmed real `log_device` rows
landing on schedule via `GET /logs/devices` (`source: "data-logger"`),
confirmed zero false-positive warnings while healthy, then stopped
`apps/device-service` outright - `critical` flipped `true` on the Data
Logger process within two periods with an accurate
`overdue_device_{id}` WEM entry, and cleanly auto-resolved (`critical`
back to `false`, message gone) within one period of restarting
`device-service`. UI verified in a real browser: both global switches,
the per-device list, the edit popup (period placeholder renders exactly
as specified), and the write/ignore switch's disabled-until-configured
state all behave correctly; console clean.

## 33. Library Catalog (browsable/searchable index over `devices/`)

A read-only, breadcrumb-navigated browser over `devices/`'s design-time
layout (section 7) - "nodes and libraries convenient to keep in one
[searchable] table", per the user's own spec, 2026-08-01. Forced the
section 7 restructuring documented there: a Device can no longer live
inside a Node's own folder, since a category/browsable-item tree needs
every node to be independently movable/categorizable without touching
any other node's folder. Categories/items are managed by moving folders
in git and editing their descriptor files - this feature has no
create/edit/delete UI of its own, it's a cache of what the filesystem
currently says, rebuilt by a sync.

### Filesystem convention

Any folder under `devices/standalone/` (kind `device`) or `devices/nodes/`
(kind `node`) - two independent trees, never merged - is exactly one of:

- **A leaf item** - has its own `library.json`:
  `{id, name, description}`. `id` is developer-assigned once, when the
  DN is created, and never changes afterward, even if the folder is
  renamed or moved to a different category (AGENTS_TO_DO.md, 2026-08-01:
  "генеруємо, коли створюємо DN... і він не змінюється потім") - this is
  the catalog's real identity, not the folder path. Not recursed into
  further - `config/`, `docs/`, `tests/`, etc. underneath are that DN's
  own implementation detail, not catalog structure. An optional
  `icon.svg`/`icon.png` alongside `library.json` is shown in the browser
  if present, a generic fallback icon otherwise.
- **A category** - has its own `category.json`: `{name, description}`,
  plus the same optional icon convention. Recursed into - arbitrary
  nesting depth, subcategories and leaf items mixed freely inside one
  category.
- **Neither** - a plain pass-through folder (e.g. `devices/standalone/`
  itself has no descriptor of its own) - recursed into, contributing no
  row, its children attach to whatever the *nearest actual category
  ancestor* was (or the tree root, if none).

Moving a DN to a different category is exactly `mv` the folder plus
re-running the sync - there is no "rename" tracking, a folder that no
longer exists at its old `folder_path` is just deleted and (if it still
exists somewhere else) picked back up fresh under its new path, matched
back to its existing catalog row purely by its own `id`.

A Node type's `node.yaml` carries an additional `supports:` list (device-
type names it's typically paired with, section 7) - read straight into
`library_items.supports` for node items, purely informational, nothing
at runtime enforces it.

### Sync (`apps/api/src/libraryCatalog.ts`)

`syncLibrary()` walks `devices/standalone/` and `devices/nodes/` under
`config.apiPlugins.builtinDevicesDir` (reused as-is from the Command-API
extension points config, section 31 - no new env var), plus, if
`config.apiPlugins.extraDir` is set, a target project's own private
`plugins/` (scanned flat, kind `device` only - there's no private-node
equivalent of `devices/nodes/` today). Upserts `library_categories`/
`library_items` (`ON CONFLICT (folder_path)`/`ON CONFLICT (id)` -
category rows keep a stable numeric id across re-syncs, item rows keep
their developer-assigned one), then deletes any row whose `folder_path`
wasn't seen this pass - a full, cheap, idempotent rebuild, safe to run
any time.

Runs once automatically on every `apps/api` startup (the user's own
spec: "метод аналізу... повинен запускатися автоматично при билді
проекту" - same idempotent-on-every-start convention as
node-pg-migrate's migrations; a sync failure is logged, not fatal, so it
can never block the API from starting), and on demand via
`POST /library/sync` (the page's own Sync button) for a same-session
folder move.

### API (`apps/api/src/routes/library.ts`)

- `POST /library/sync`
- `GET /library/browse?kind=device|node&categoryId=` - one folder
  level's worth of children (subcategories and leaf items mixed, sorted
  by name) plus the breadcrumb trail up to the root; `categoryId`
  omitted means the root of `kind`'s own independent tree.
- `GET /library/search?kind=device|node&q=` - flat, cross-category
  `ILIKE` on name/description (the user's own explicit goal: "зручно
  для пошуку").
- Every item in both responses carries `usedInProject` - `type_name`
  (the folder's own basename, tracked separately from the free-text
  `name`) checked against this same running instance's own live
  `devices`/`nodes` registry (`SELECT DISTINCT type`), confirmed with
  the user as the intended scope ("Postgres DN-реєстр тієї ж запущеної
  UI-інстанції") over a source-code-only "is this referenced anywhere"
  check.

Icons are served statically, not stored in Postgres - `library_items.
icon_path`/`library_categories.icon_path` are pre-built URLs like
`/library-assets/library/standalone/heater/icon.png`, matching two
`@fastify/static` mounts registered in `server.ts` (`/library-assets/
library/*` -> `builtinDevicesDir`, `/library-assets/private/*` ->
`extraDir` when set) - `decorateReply: false` on every registration
after the first avoids `@fastify/static`'s "sendFile decorator already
added" error.

### UI (`apps/ui/src/views/library/LibraryBrowser.jsx`)

New top-level nav item "Library" (alongside Nodes/Devices/Dev Simulator).
A Devices/Nodes button-group switch (two independent trees, never
merged in one view) at the top, a Sync button, a search box, and below
that either the breadcrumb-driven category browser or (while a search
term is active) the flat search results. The breadcrumb strip is
modeled directly on `sevenstime-backoffice`'s `web-interface/src/views/
base-elements/Categories.js` - same "Root / Cat1 / Cat2" clickable path
plus an up-arrow image, that exact `up.png` asset copied verbatim into
`apps/ui/src/assets/images/` per the user's explicit preference over the
equivalent already-in-use CoreUI `cilArrowTop` icon. Unlike that
reference component, there is deliberately no add/edit/delete category
UI here at all - only the browsing/table/breadcrumb half of it applies,
since this catalog's data comes from git, not form submissions.

### Verified live

Not just the two demo items - a real throwaway category+item pair
(`devices/standalone/_synctest/category.json` + a nested `dummy-item/
library.json`) copied into the running `api` container, synced (`1
category, 8 items` - 7 real + 1 dummy, across both kinds), confirmed via
`GET /library/browse` that the category appeared at the tree root and
the dummy item appeared correctly nested one level inside it with the
right breadcrumb, then the folder was removed and re-synced - both rows
disappeared (orphan cleanup), counts back to `0 categories, 7 items`
(6 devices + 1 node). `usedInProject` cross-checked directly against
`GET /devices`'s live `type` values (`active-buzzer`/`light-regulator`
- the only two demo devices actually seeded in this instance - correctly
`true`; the four relocated thermal device types, not seeded here right
now, correctly `false`). UI verified in a real browser end to end: kind
switch, breadcrumb navigation into and back out of a category, search,
and the Sync button's own success message; console clean throughout.

## 34. Node Groups and Device Groups (logical/business groups, distinct from Library categories)

Two new group entities (AGENTS_TO_DO.md, 2026-08-01), unrelated to the
Library Catalog's filesystem-driven categories (section 33) or the
Processes page's three group entities (section 23) - these group
*registry* rows (`nodes`/`devices`), not library items or processes, and
are entirely admin-managed through the UI, not derived from disk or from
process membership.

The two shapes intentionally differ, mirroring section 23's own finding
that "group of X" isn't one relationship shape:

- **Node Groups** (`node_groups` + `nodes.group_id`,
  `routes/nodeGroups.ts`) - single-FK, exactly like Process Groups
  (section 19). A Node models one physical workplace served locally by
  one group of Nodes, so it belongs to at most one Node Group at a time.
  `group_id` is nullable (unlike `processes.group_id`, which is `NOT
  NULL` with a backfill) - existing Nodes predate this feature and have
  nothing to backfill from; `ON DELETE RESTRICT` plus a pre-check in
  `routes/nodeGroups.ts`'s `DELETE` (mirroring `processGroups.ts`'s
  `withDeletable()`/"group is not empty" idiom exactly) keeps a
  non-empty Node Group from being deleted.
- **Device Groups** (`device_groups` + `device_device_groups`,
  `routes/deviceGroups.ts`) - many-to-many, like Tab/Message Groups
  (section 23). A Device models a logical workplace and can be in
  several Device Groups at once - the user's own examples: a siren
  shared between a "fire" and "intrusion" group, or lighting and
  indication grouped together. Freely deletable via `ON DELETE CASCADE`,
  no emptiness rule, no ordering.

A Device's Node assignment (`devices.node_id`, single/nullable) is
unchanged from the 2026-07-27 Device/Node refactor (section 30) - a
device may or may not belong to a node, independent of which Device
Groups it's in.

### Two different "Config" concepts, per the user's own clarification

> "Маппінг груп і нод пристрою відбувається в Config попапі кожного
> елемента DN. Редактор груп - на сторінці в Config."

- **Page-level Config button** (`NodesList.jsx`/`DevicesList.jsx`, left
  of the filter row's Reset Filters button, same `cilSettings` icon as
  every other Settings/Config trigger in this app) opens
  `GroupsConfigModal` - a new, thin `CModal` wrapper around the existing
  `NamedListManager` (unmodified, reused as-is). This is the group
  *list* editor: add/rename/delete Node Groups or Device Groups. Popup
  form, not a Settings tab - Nodes/Devices have no Settings tab of their
  own the way the Processes page does (section 19's `SettingsTab.jsx`),
  so `GroupsConfigModal` is the popup-chrome equivalent of that inline
  `CCard` usage.
- **Per-row Settings button** (Actions column, same position/icon as
  `ProcessesTable.jsx`'s per-process Settings button) opens a per-item
  popup that assigns *this* item's own group membership:
  `NodeSettingsModal` (single group `CFormSelect`, since a Node has at
  most one) or `DeviceSettingsModal` (group `CFormCheck` multiselect,
  modeled on `ProcessSettingsModal.jsx`'s `GroupCheckboxSection`, plus a
  Node `CFormSelect` saved together in the same `Promise.all` - the
  user's explicit requirement that a device's group memberships and node
  assignment are edited from the same popup, not two).

Both per-row modals skip `ProcessSettingsModal`'s fetch-on-open dance
(`GroupCheckboxSection`'s mount-only effect with its own cancellation
guard) - `group_id`/`device_group_ids`/`node_id` already arrive on every
row from `GET /nodes`/`GET /devices` (see below), so there is nothing
left to fetch when a popup opens; a `useEffect` keyed on `[visible,
node|device]` just seeds local state from the already-loaded row,
`eslint-disable-next-line react-hooks/set-state-in-effect` per row like
`LibraryBrowser.jsx`'s precedent (section 33).

### API

- `routes/nodeGroups.ts` / `routes/deviceGroups.ts` - CRUD, copied
  structurally from `processGroups.ts`/`tabGroups.ts` respectively (see
  above for which).
- `routes/nodes.ts` - `GET /nodes`/`GET /nodes/:id` now `LEFT JOIN
  node_groups` for `group_name` (the list page needs it on every row, not
  fetched separately); new `PATCH /nodes/:id/group {groupId}`.
- `routes/devices.ts` - `GET /devices`/`GET /devices/:id` now join
  `nodes` for `node_name` (**fixes a pre-existing UI bug**: `DevicesList.
  jsx`'s Node column was rendering the raw `node_id` FK, not a name) and
  `array_agg` over `device_device_groups` for `device_group_ids`, one
  query rather than the per-row N+1 `withDeletable()`/`withProcessIds()`
  idiom used for admin group-list screens - this is the hot per-row list
  path, not an occasional Settings-tab fetch. New `GET`/`PUT
  /devices/:id/device-groups` (full-replace-in-transaction, exact shape
  of `processes.ts`'s `/tab-groups` endpoints) and `PATCH
  /devices/:id/node {nodeId}`.

### Verified live

Rebuilt (`make up-all`), migration `1690000000038` ran clean (`GET
/nodes`/`GET /devices` both returned successfully with the new joined
fields, no nodes registered in this instance so `[]`/populated-but-
nodeless respectively). Via `curl`: created a Node Group and a Device
Group, assigned a temporary directly-inserted test Node to the Node
Group, confirmed `DELETE /node-groups/:id` correctly 400s ("group is not
empty") while occupied and 204s once cleared - RESTRICT-then-precheck
behaving exactly like `process_groups`; assigned a real device
(`active-buzzer-01`) to a Device Group via `PUT .../device-groups` and
confirmed `DELETE /device-groups/:id` succeeds immediately even while
occupied (CASCADE, no precheck) - the two group shapes actually behaving
differently, not just differently coded. Test Node removed after.

Browser-verified end to end on both pages (real UI, not just API): the
page-level Config button opens `GroupsConfigModal`, added "Heating" (Node
Groups) and "Lighting" (Device Groups) through the actual add form; the
filter row's group dropdown correctly narrowed the Devices list to just
the one device in "Lighting" after assigning it via the per-row Settings
popup, and Reset Filters correctly cleared it back to both rows; the
Devices list's Node column showed `-` for an unassigned device instead of
a raw id, confirming the bug fix. Console clean throughout.

## 35. Filter row layout convention (left/right block split) + per-item rename

Two small, unrelated fixes requested together as a follow-up to section
34's Node/Device Groups work (AGENTS_TO_DO.md, 2026-08-01).

### Canonical filter row: left block vs. right block

Every filter row in this app (`ResetFiltersButton`, section 26) now
follows one template, made explicit here because it previously existed
only as convention-by-copying, not a documented rule - the very first
version of `NodesList.jsx`/`DevicesList.jsx`'s Config button broke it by
accident (placed first in the left block instead of the right one):

- **Left block**, pinned left (each filter its own `xs="auto"` `CCol`,
  filters in priority order - more consequential filters leftmost, the
  search box last/rightmost within this block, e.g.
  `ProcessesTable.jsx`'s group -> type -> status -> search).
- **Right block**, pinned right (a single non-`xs="auto"` `CCol
  className="d-flex justify-content-end gap-2"`, taking the row's
  remaining width and right-aligning its own contents) - a page's own
  extra buttons (Config, Reload...) in whatever order makes sense for
  that page, with `ResetFiltersButton` always the last element. The
  Logs tabs' `IconButton` (Reload) + `ResetFiltersButton` pairing
  (`DeviceLogsTab.jsx` etc.) already matched this exactly and is the
  reference implementation the fix below now also follows.

Applied to `NodesList.jsx`/`DevicesList.jsx`: the page-level Config
button moved out of the left block (where it was sitting before the
group dropdown) into the right block, immediately before
`ResetFiltersButton`, `gap-2` added to that `CCol`'s className to space
the two buttons apart.

### Per-item rename, in the same Config popup

`NodeSettingsModal.jsx`/`DeviceSettingsModal.jsx` (section 34's per-row
Settings/"Config" popups) each gained a Name text field at the top,
saved together with the existing group/node fields in the same
`Promise.all` - the user's own name for these popups throughout section
34's discussion was "Config попап", so a Name field belongs there rather
than as a separate rename control. New endpoints: `PATCH
/nodes/:id/name` and `PATCH /devices/:id/name`, each following the exact
409-on-unique-violation pattern every other named-entity rename in this
app already uses (`processGroups.ts` etc.) - both `nodes.name` and
`devices.name` are `UNIQUE`. Client-side empty-name validation happens
before the request fires (`trim()` + early return), matching
`NamedListManager`'s own guard.

### Verified live

Rebuilt (`make up-all`), `tsc`/`eslint` clean on both `apps/api` and
`apps/ui`. Browser-verified: Config button now sits at the right edge of
the filter row on both Nodes and Devices pages, immediately left of
Reset Filters, matching the Logs tabs' existing Reload+Reset placement;
opened a Settings popup, changed a device's Name, saved, confirmed the
new name appeared immediately in the table row and the modal's own
header re-rendered with it live.

## 36. System tick indicator (header, green pulse)

A small green circular dot in the Main Header, left of the Notification
icons - pulses once per `apps/orchestrator` tick, arriving live over the
Socket Server (AGENTS_TO_DO.md, 2026-08-01: "зелений круглий індикатор,
який блимає по тіках системи з Socket Server"). Purely cosmetic - "the
system is alive," nothing more - not a data channel and not read by any
other feature.

### Why a genuine new tick pulse, not a reused broadcast

The obvious cheap option was piggybacking `apps/api`'s existing process
public-state broadcast (section 24, `process.state.snapshot`, default
5s timer, occasionally sooner on urgent triggers) - zero new backend
code. Rejected: that broadcast's cadence is irregular by design (the
whole point of its urgent path) and 5s is a poor match for "tick" - this
codebase already has a well-established, precise meaning for that word
(`apps/orchestrator/src/tickInterval.ts`'s `TICK_INTERVAL_MS = 1000`,
the same tick Heartbeating Control counts skips against), so the
indicator should reflect *that* tick, not an unrelated timer that
happens to also be periodic.

### Wire path

`apps/orchestrator/src/server.ts`'s `tick()` - already running every
`TICK_INTERVAL_MS` - fires `apiClient.tick()` at its very top,
fire-and-forget (`void ... .catch(...)`, never awaited: a slow/failed
publish must not delay that tick's actual process runners). New
`apps/api/src/routes/systemTick.ts`: `POST /system/tick` does exactly
one thing - `redis.publish("system:tick", Date.now().toString())` - no
DB read, no cache key, no assembled payload, the cheapest possible
notify, same lightweight Redis Pub/Sub idiom `processBroadcast.ts`
already uses for `process:state:updated` (section 24) but without that
one's cache-key half, since a tick pulse carries no meaningful data of
its own beyond "one just happened."

`apps/messaging-gateway/src/server.ts` subscribes to `system:tick`
alongside its existing `process:state:updated` subscription (one
`subscriberRedis.on("message", ...)` handler now dispatches on
`channel`) and relays it straight through as a WS event -
`{routingKey: "system.tick", envelope: {domain: "tick", timestamp}}` -
the same synthetic-routing-key idiom `PROCESS_STATE_ROUTING_KEY`
already established, so a client's `topics=` pattern filtering already
works on it for free. No initial-snapshot entry on a fresh connection
(unlike process state) - a tick is transient, there is nothing
meaningful to hand a client before the next one fires a second later.

`apps/ui/src/api/useSystemTick.js` - a `useLiveProcess.js`-style hook,
`subscribeToLiveEvents` filtered to `routingKey === "system.tick"`,
returning a counter that increments once per tick (the counter's value
has no meaning of its own - it only exists to *change*).
`apps/ui/src/components/header/SystemTickIndicator.jsx` uses that
counter as the dot's own React `key`: changing a `key` unmounts and
remounts the element, which restarts its CSS animation from 0% every
time - deliberately *not* `NotificationCenter.jsx`'s `.wem-blink-ring`
approach (`animation: ... infinite`), which would keep blinking forever
even if ticks actually stopped arriving (WS disconnected, orchestrator
down) - this dot only ever pulses in direct response to a real tick,
and visibly stops if they do.

### The pulse itself

`apps/ui/src/scss/style.scss`'s `@keyframes system-tick-pulse` (~450ms:
long enough to register at a glance, short enough to have fully settled
before the next tick arrives a second later) - scale 1 -> 1.25 -> 1,
opacity 1 -> 1 -> 0.35, a `currentColor` glow (`box-shadow`) that
blooms then vanishes. `color: var(--cui-success)` on the base
`.system-tick-dot` (not a hardcoded hex) so both the fill and the glow
track CoreUI's own success color across light/dark mode, matching how
`NotificationCenter.jsx` already leans on Bootstrap's `bg-{color}`
utilities rather than fixed colors. Idle state (between pulses) sits at
the same 0.35 opacity the animation's own `100%` frame ends on - no
`animation-fill-mode` needed, the two already agree.

### Verified live

Rebuilt (`make up-all`), `tsc` clean on `apps/api`/`apps/orchestrator`/
`apps/messaging-gateway`, `eslint` clean on `apps/ui`. Confirmed the
orchestrator is actually calling `POST /system/tick` once a second (API
request logs, one `system/tick` line ~1000ms apart, indefinitely, no
errors). Connected a raw WebSocket client directly to the messaging-
gateway container (bypassing the UI, bypassing nginx) and captured five
consecutive `system.tick` events over a 5s window, each ~1000ms apart,
exact envelope shape `{domain: "tick", timestamp}` as designed - the
whole Redis-Pub/Sub-relay chain working end to end, not just the two
ends independently. Browser-verified: the dot renders in the header, in
the correct position (left of the Notification bells); its accessible-
tree reference goes stale roughly once a second on its own (confirming
the element is genuinely remounting on each tick, not just visually
pulsing via a CSS class toggle); console clean after a hard reload (one
stale-chunk fetch error immediately following the rebuild, gone on a
second reload - a normal artifact of swapping a running dev bundle
mid-session, unrelated to this change).

## 37. Logs page redesign: Commands widened to processes, per-row actor identity, Messages rename

Triggered by a real production symptom (AGENTS_TO_DO.md, 2026-08-01): a
running project's Commands log had grown to 41k+ rows, almost all
identical `auto`/`false` repeats for the same device. Root cause,
diagnosed before any redesign work started: `PUT /devices/:id/auto` (the
orchestrator-driven write path) called `logCommand()` unconditionally on
*every* tick, even when the value hadn't changed - a control-loop
process re-asserts its computed output every cycle by design (so a
device that drifted independently still gets corrected next tick), not
just on change, and every one of those routine reassertions was being
logged as if it were a new command. **Fixed first, independently of the
redesign below**: `routes/devices.ts`'s `/auto` handler now reads the
device's current `valueAuto` via `dualDevicesModel.getState()` before
writing, and only calls `logCommand()` when it actually differs - the
reassertion write/publish itself still happens every tick regardless,
only the audit-log entry is suppressed. Mirrors a precedent already set
once for `log_device`: `dualDevicesModel.ts`'s `publishReading()`
comment already documents the 2026-07-27 refactor dropping this exact
"log every tick" behavior for sensor readings; this closes the same gap
for commands.

Investigating that bug surfaced a second, larger gap: the Commands tab
only ever covered device writes - a process's ON/OFF switch and its
config/parameter changes were (and always had been) completely
unlogged, and no row anywhere said *who* issued a command; `source` was
always the literal string `"api"`, useless for that purpose. The user's
own request scoped a full three-tab redesign:

### Commands tab - now covers processes too, with per-row actor identity

`log_command` (migration `1690000000039`) gains `process_id` (nullable
FK `processes`, mirrors `device_id`'s own nullable/`ON DELETE SET NULL`
shape - deliberately no "at least one of device_id/process_id" CHECK,
since that would break the exact reason `device_id` is nullable in the
first place: a later delete of the referenced row must be free to null
the column out without invalidating an already-written log row),
`actor_type` (`'user' | 'orchestrator'`, NOT NULL, backfilled from
`action` - `auto` was always orchestrator-only, the other three were
always UI-only, so this is an exact backfill, not a guess), and
`actor_user_id` (nullable FK `users` - null for `actor_type =
'orchestrator'`, since the orchestrator has no user account and never
will; it's not a login-capable actor, just an unauthenticated internal
caller). `action`'s CHECK widens to add `'on'`, `'off'`, `'config'`.

**The routes that create these rows previously had no way to know who
was calling them** - `routes/devices.ts`'s write/simulate/release and
`routes/processes.ts`'s action/config routes were all deliberately
unauthenticated (`auth.ts`'s own comment: "a separate, not-yet-started
task"). Confirmed with the user before doing this: since the whole UI
is already behind `AuthGate` (section 13) and the session cookie
already rides every same-origin fetch automatically
(`apps/ui/src/api/client.js`'s own comment on this), adding `{
preHandler: requireAuth }` to exactly these five routes doesn't change
normal UI behavior at all - it only means a direct, cookie-less API
call (curl/Postman) now needs a real login first. `PUT /devices/:id/
auto` deliberately stays unauthenticated - it's orchestrator-only, and
the orchestrator has no credentials to send; its `logCommand()` call
just hardcodes `actorType: "orchestrator"`.

- `POST /processes/:id/action` (ON/OFF) now logs `{processId, action:
  action === "ON" ? "on" : "off", actorType: "user", actorUserId:
  request.user.sub}` right before applying the change - no `value`
  (same "nothing meaningful to log" reasoning `release` already had).
- `PATCH /processes/:id/config` now logs `{processId, action: "config",
  value: request.body, ...}` - `value` is the partial patch actually
  sent, not the whole resulting config, matching "value is what was
  written" everywhere else in this table.

`commandLog.ts`'s `listCommandLogs()` now `LEFT JOIN`s both `devices`
and `processes` (search matches whichever one a row targets) and
`users` (for `actor_user`), plus new `actorType`/`actorUserId` filter
params. New non-admin-gated `GET /users/directory` (`routes/users.ts`,
a separate exported function outside `userRoutes`' `requireAdmin`
preHandler hook) - the existing `GET /users` is fully admin-gated
(roles/password management), but the Commands tab's actor filter needs
a minimal id/username/display_name/avatar_path listing for *any*
logged-in user, not just admins; same unauthenticated-read precedent
`log_messages`'s `hidden_by_user` join already established for exposing
these same fields.

UI (`CommandLogsTab.jsx`): new Actor filter dropdown (All users /
Orchestrator / each real user) and an Actor column replacing the old,
always-`"api"` Source column - a `CAvatar` (photo or initials, exact
same pattern `ProcessMessageLogsTab.jsx`'s `hidden_by_user` rendering
already used) for a human actor, or a dark `CAvatar` wrapping the same
`cilSettings` icon this app already uses for orchestration/Processes
(`_nav.jsx`) for the orchestrator - deliberately reusing that icon's
existing meaning rather than introducing a second "system" glyph. A
`user`-typed row with no `actor_user` (a legacy row from before this
migration - the backfill only knew "was a human", never who) renders a
generic `?` avatar titled "Unknown user". Device column renamed
"Target" (shows whichever of device/process name applies - a row
targets exactly one), and `formatValue()` now JSON-stringifies object
values (the `config` action's diff) instead of `String()`-ing them into
`"[object Object]"`.

### Devices tab

Unchanged, per explicit instruction.

### Messages tab (renamed from "Processes")

The existing `ProcessMessageLogsTab.jsx` (WEM type filter, process
filter, text search, date range) already matched the requested spec
exactly - no code changes, `LogsList.jsx`'s `TAB_DEFS` label is now
"Messages".

### Verified live

Root-cause fix verified first, in isolation: watched `GET /logs/
commands`'s total command count stay frozen across a 5-second window
for a device stuck at a constant `false` (previously one new row every
single second, confirmed via the exact same 41k+-row project's live
data). Auth enforcement: an unauthenticated `curl` to `PUT .../simulate`
and `POST .../action` both now 401 (`{"error":"unauthorized"}`); logged
in via `POST /auth/login`, the same two calls (plus a config PATCH)
succeed and each produced exactly one `log_command` row with the
correct `actor_user` (id/display_name/username/avatar_path all
resolved), `process_name` resolved for the process rows, and `value`
holding the right shape (`null` for on/off, the partial patch object
for config). Filtering verified via `curl`: `actorType=orchestrator`
returns only the `auto` rows with `actor_user: null`; `actorType=user`/
`actorUserId=1` both correctly scope to the logged-in admin's own
rows; `search=Zummer` matches on `process_name` (previously only
`device_name` was searched). Browser-verified end to end: Actor column
shows the admin's avatar photo on user rows and the dark gear-icon
badge on orchestrator rows; the Actor filter dropdown lists "All users
/ Orchestrator / Administrator / System"; selecting "Orchestrator"
correctly narrows the table to only `auto` rows and shows the Reset
Filters button, which correctly restores the full list on click; the
Messages tab shows its renamed label. Console clean (one stale-chunk
fetch error from the exact rebuild moment, gone on a second reload -
the same benign artifact section 36 already documented). `tsc`/`eslint`
clean on `apps/api` and `apps/ui`.
