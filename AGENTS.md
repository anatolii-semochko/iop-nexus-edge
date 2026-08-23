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

`devices/standalone/actuator/light-regulator/` and
`devices/standalone/speaker/active-buzzer/` are real device types
built to this layout - `runtime/`
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
outside its own package (`import ... from
'devices/standalone/actuator/light-regulator/ui/simulator/LightRegulatorSimulator.jsx'`)
via a `'devices/'`
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

**Temperature (`temp`, added 2026-08-08)**: same no-dependency stance,
extended rather than abandoned once the question came up — reads
`/sys/class/thermal/thermal_zone*/temp` directly (`readTempCelsius` in
`resourceMonitor.ts`), no `systeminformation`, no `vcgencmd` shellout. On
Raspberry Pi OS the kernel's own `bcm2835_thermal` driver exposes the SoC
temperature at `thermal_zone0` with no extra tooling; a generic x86 dev
machine can expose several zones (`acpitz`, `x86_pkg_temp`, `nvme`,
`iwlwifi`, ...) with no single well-known "the CPU" index, so the reading
reported is the **highest value across every zone found**, keeping this a
single number like the other three metrics and matching the existing
critical/warning model's own framing ("is anything on this host over
threshold"), not per-sensor alerting. Requires the container to see host
sysfs, which is Docker's default behavior, not a bind-mount this project
adds — if `/sys/class/thermal` isn't present or isn't readable at all
(most likely on a dev machine without that access), `readTempCelsius`
returns `undefined`, `ProcessMetrics.temp` is omitted from that tick's
payload entirely (not sent as `0`, which would misread as "freezing"), and
every temp-related critical/warning/message check below is skipped for
that tick only — the same "absent, not defaulted" treatment CPU's own
first-tick-after-restart case already gets. Unlike the other three
metrics, `tempMax`/`tempWarnMax` are degrees Celsius, not a percentage —
seeded defaults (migration `..._add-temp-thresholds-to-resource-monitor`)
are 70/80°C, taken from the Raspberry Pi SoC's own documented throttling
points (soft throttle ~80°C, hard throttle steps at 85°C) rather than an
arbitrary round number, since this project's actual deployment target is a
Pi.

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
`ramMax`/`diskMax`/`tempMax` (error — red row, the original `critical`
concept) and `cpuWarnMax`/`ramWarnMax`/`diskWarnMax`/`tempWarnMax`
(warning — yellow row, a second, less severe Redis flag added alongside
`critical`). **A threshold of 0 (or omitted) disables that specific
check** — per metric, independently, not an all-or-nothing gate on the
whole tick the way temperature-monitor's `min`/`max` are.

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

**UI** (`apps/ui/src/views/processes/ResourceMonitorPanel.jsx`): four
rows, not four processes — CPU/RAM/Disk/Temp, each with its live reading in
large type, a "Warning Max" `NumericStepper` and, right after it, an
"Error Max" one (step 1, same component `TemperatureProcessPanel` uses -
see section 7's `NumericStepper` entry for the hold-to-repeat mechanism
itself) for that metric's own two thresholds. `METRIC_ROWS` carries each
row's own `unit`/`stepperMax` rather than hardcoding `%`/100 everywhere,
since Temp's unit is °C and its steppers are clamped `min={0} max={150}`
instead of the `100` the three percentages use - a live reading of
`undefined` (Temp on a host with no readable thermal zone) renders as `-`,
same placeholder the panel already used for CPU's own first-tick gap. The row itself (`ProcessesList.jsx`) picks
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
of the four rows): a rolling 60-second CPU/RAM/Disk/Temp line chart, one
hand-rolled inline SVG, not a charting dependency - same "Node built-ins/no
extra package" call already made for the metrics themselves. Temp's line
shares the same 0-100 y-axis as the three percentages despite being °C, not
a second scale — this project's Raspberry Pi target throttles around 80°C,
comfortably inside that range for normal operation, so the shared axis
reads fine in practice; a sample with no `temp` (thermal zone unreadable)
just draws as 0 on that one line, same as any other undefined key would. There is no
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
`devices/standalone/speaker/active-buzzer/` (same layout as `light-regulator`,
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
pattern as `TemperatureProcessPanel`. `devices/standalone/speaker/active-buzzer/
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
  `devices/standalone/actuator/light-regulator`. New convention established here
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

`apps/ui/src/scss/style.scss`'s `@keyframes system-tick-pulse` (100ms,
shortened 2026-08-09 from an initial 450ms - see AGENTS_TO_DO.md's
"НОДА КОНТРОЛЮ" thread, which picked this same pulse duration for its
firmware LED and found 450ms too long/laggy for a quick flash; 100ms
still registers at a glance and stays well clear of the next tick a
second later) - scale 1 -> 1.25 -> 1,
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

## 38. Logs/Commands follow-ups: system-user actor, column order, Actions alignment, Notifications default tab

Four small fixes (AGENTS_TO_DO.md, 2026-08-01), on top of section 37.

### The orchestrator IS the "system" user - no separate actor type

Section 37's synthetic `actor_type: 'orchestrator'` turned out to
duplicate a concept that already existed: `routes/users.ts`'s "system"
user is a protected, non-deletable service account seeded specifically
for this. Migration `1690000000040` backfills every existing
`actor_type = 'orchestrator'` row's `actor_user_id` to the real "system"
user's id, then drops `actor_type` and its CHECK entirely -
`CommandLogEntry.actorUserId` is now always required, never optional,
and there is no more `CommandActorType` in the type system at all. New
`commandLog.getSystemActorUserId()` - looked up once by username
(`'system'`) and cached in memory forever after the first successful
call (only caches on success, so a lookup failure at boot doesn't wedge
every later call into repeating the same error) - `routes/devices.ts`'s
`/auto` handler calls it instead of hardcoding an actor type. Net
effect: the "system" user now just IS the orchestrator's identity
everywhere in this table, rendered with its own real avatar in the
Commands tab exactly like any human actor - no more special-cased gear
icon, no more separate "Orchestrator" entry in the actor filter
dropdown (`GET /users/directory` already returns "system" like any
other active user, so it appears there for free).

### Actor column moved first

`CommandLogsTab.jsx`'s column order is now Actor / Time / Target /
Action / Value - who did it reads more usefully at a glance than the
timestamp.

### Actions column: always right-aligned (new default table convention)

Adopted as a standing rule for every table in this app, not just this
one instance: **a table's rightmost "Actions" column - header cell and
every data cell - is right-aligned** (`className="text-end"` on the
`CTableHeaderCell`/`CTableDataCell`; a cell with multiple buttons also
wraps them in `<div className="d-flex justify-content-end align-items-
center gap-1">` inside the cell, not just the cell class alone). No new
SCSS class was added for this - Bootstrap's own `text-end` utility
(already CoreUI's own convention, see `ProcessesTable.jsx`'s pre-
existing Actions column, which already did exactly this) fully covers
it; introducing a bespoke class would only duplicate what the utility
class already does. Applied now to `NodesList.jsx`/`DevicesList.jsx`
(both previously left-aligned, unlike `ProcessesTable.jsx`) - any new
table's Actions column should follow this from the start rather than
needing a follow-up fix like this one.

### Notification center popup: smarter default tab

`NotificationCenterModal.jsx` always opened on "New" regardless of
whether something more urgent was already active. Now: "Active" if
it's visible for the selected type (not `message` - a one-shot message
never has an "active" concept) and currently non-empty, "All" otherwise
- "New" is still manually selectable, just never the auto-picked
default. Implemented as a `useEffect` keyed only on `type` (opening the
modal or switching type inside it), deliberately *not* on `activeItems`
- this decides where to land when the type selection changes, not
continuously yank the user back to "Active" every time a new alarm
arrives while they're reading a different tab. This component never
unmounts (only its rich content toggles on `type` being non-null), so
`useState('new')`'s initial value can't provide a fresh default on
every open by itself - an effect reacting to `type` is the only way.

**Bug found and fixed during live verification, not present before this
change**: switching straight to "Active" (now possible from a
background effect, not only a user's own tab click) could leave the
New/All tab's REST-fetch effect's `loading` flag stuck `true` forever -
that effect's own cancellation guard (`if (cancelled) return` in its
`.then`/`.finally`) correctly skips a stale response's state updates,
but its early-return branch for `effectiveTab === 'active'` never reset
`loading` itself either, and Active's own view never fetches at all to
ever clear it. Reproduced live: opening the Errors bell while an error
was genuinely active landed correctly on "Active" but showed an
infinite spinner over an otherwise-already-rendered-empty view. Fixed
by having that early-return branch explicitly `setLoading(false)`
before returning.

### Verified live

Migration backfill confirmed via `curl`: pre-existing `auto` rows (the
same ones from section 37's verification) now show `actor_user: {id:
2, username: "system", ...}` instead of the old `actor_type:
"orchestrator"` shape; a fresh process ON/OFF toggle still attributes
to the logged-in admin correctly; no `"system user not found"` errors
in API logs across a rebuild. `GET /users/directory` returns exactly
`admin`/`system`, confirming no synthetic third entry. Browser-verified:
Commands tab's actor filter dropdown lists only "All users /
Administrator / System" (no "Orchestrator"); orchestrator-driven rows
show the system user's own avatar image, not an icon; Actor is the
leftmost column. Forced a genuine active error (`PUT .../heartbeat-
test-failure {simulate:true}`) and confirmed the Errors bell opens
directly on "Active" with real content and no stuck spinner (both
before *and* after the loading-flag fix - the bug was caught precisely
by this live check, not by code review); confirmed the empty case
separately (Warnings bell with nothing currently active correctly
opens on "All", tested twice under two different type selections).
Reverted the forced test failure afterward. Console clean, `tsc`/
`eslint` clean on `apps/api` and `apps/ui`.

## 39. Persisted page state rolled out to Nodes, Devices, Live Events, Logs, Users

Section 17's `usePersistedState`/`utils/cookies.js` mechanism had
exactly one adopter since it was built (`ProcessesList.jsx`) - its own
doc comment invited "the next page that wants either adopts the hook/
component directly." This is that adoption (AGENTS_TO_DO.md,
2026-08-01), across five pages at once, in the two shapes the section
already described:

- **Flat variant** (no tabs) - `NodesList.jsx`, `DevicesList.jsx`,
  `UsersList.jsx`, `LiveEvents.jsx`. Each gets its own `PERSISTED_
  DEFAULTS` (flat `{ filterA, filterB, ..., pageSize }`) and cookie name
  (`nexusedge.nodesPage`, `.devicesPage`, `.usersPage`,
  `.liveEventsPage`) - AGENTS.md's own section 17 flat example was
  historical/unused until now; these are its first real instances.
  `search` stays wired through a local, unpersisted `searchResetToken`
  exactly as before (a remount trigger for `TableSearchInput`, not
  meaningful state). `LiveEvents.jsx`'s `limit` (buffer size) persists
  too even though it's deliberately excluded from that page's own
  `hasActiveFilters`/`resetFilters` (it changes what's buffered, not
  just what's shown) - same preference role `pageSize` plays everywhere
  else; its `limitRef` (read by the WS subscription effect so changing
  the limit doesn't require resubscribing) now seeds from the restored
  value, not the module constant, so a restored preference applies from
  the very first live event after a reload, not only after the next
  manual change.
- **Tabbed variant** - `LogsList.jsx` (Commands/Devices/Messages).
  Structurally different from `ProcessesList.jsx`'s own tabbed
  registration in one way worth calling out: `ProcessesList.jsx`'s three
  listing tabs all share one `DEFAULT_TAB_STATE` shape (every tab has a
  search/group/type/status filter). Logs' three tabs do NOT - Commands
  has device/action/actor/date-range, Devices has just device/date-
  range, Messages has type/process/date-range - so `LogsList.jsx` keyed
  `TAB_DEFAULTS` by tab key instead of one shared shape, and each tab's
  own `tabState(key)` fallback (`{ ...TAB_DEFAULTS[key], ...pageState.
  perTab[key] }`) resolves against its own key's shape, not a single
  common one. This forced a real structural change the flat pages
  didn't need: `CommandLogsTab.jsx`/`DeviceLogsTab.jsx`/
  `ProcessMessageLogsTab.jsx` previously owned their filter/pageSize
  state locally (`useState` inside the tab component itself) - state
  that must live in the *parent* to be persisted across a tab switch
  (each tab component genuinely unmounts when its tab isn't active, per
  section 29's own design). All three were converted to fully controlled
  components - every filter value plus its `onXChange` setter is now a
  prop, spread down from `LogsList.jsx`'s `{...tabState(key)}` plus the
  matching callbacks, the same one-prop-per-field convention
  `ProcessesTable.jsx` already established rather than a bundled
  `filters`/`onFilterChange` object.

`hooks/useServerPaginatedList.js` (the Logs tabs' server-pagination
hook, distinct from client-side `usePagination`) gained the same
`onPageSizeChange` callback `usePagination` already had - it previously
owned `pageSize` with no way to notify a caller when `setPageSize` ran,
which the flat pages' pattern already depended on. Small, backward-
compatible addition (an optional param, ignored if omitted).

### Verified live

For each of the five pages: set a filter/search/tab/page-size value in
the browser, confirmed via a genuine hard reload (not a soft re-render)
that the value survived - `NodesList`/`DevicesList` (search term),
`UsersList` (search term), `LiveEvents` (buffer size dropdown + search,
confirmed the restored buffer size took effect immediately on the very
first post-reload live event, not just visually in the dropdown),
`LogsList` (switched to the Devices tab, set its search filter,
reloaded - both the active tab selection AND that tab's own filter
survived; switched back to Commands and confirmed its filters were
untouched, proving per-tab isolation - Reset Filters on one tab doesn't
touch another tab's persisted slice). Console clean throughout (one
stale-chunk fetch error from the exact rebuild moment on the Logs page,
gone on a second reload - the same benign artifact sections 36/37
already documented, unrelated to this change). `eslint` clean across
the entire `apps/ui/src` tree, not just the touched files.

## 40. Notification center default tab: correction (empty case is "New", not "All")

Same-day correction to section 38's own fix (AGENTS_TO_DO.md, 2026-08-01
- the user's own words: "Я помилився в завданні... Якщо є активні
повідомлення - відкриваємо табу Active. Якщо немає - то 'New' (не
'All')"). The logic itself was already right - "Active" when it's
visible for the selected type and non-empty - only the fallback was
wrong: section 38 shipped `'all'` as the empty-case default; it should
be `'new'`. One-line fix in `NotificationCenterModal.jsx`'s tab-
selecting effect (`setTab(activeVisible && activeItems.length > 0 ?
'active' : 'new')`), doc comment updated to match. "All" remains
manually selectable, exactly as "New" already was under the old
(wrong) default.

Verified live: with no active warnings, opening the Warnings bell now
lands on "New" (previously landed on "All" per section 38's mistaken
spec). Console clean, `eslint` clean.

## 41. NamedListManager's "Add Group" button wrapping to two lines

Found via `git status` - an uncommitted, ineffective fix attempt already
sat in the working tree (`className="text-nowrap"` passed to
`<NamedListManager>`/`<GroupsConfigModal>` call sites in
`SettingsTab.jsx`, `NodesList.jsx`, `DevicesList.jsx`). Neither component
destructures or forwards a `className` prop at all, so that prop was a
silent no-op everywhere it was added - React drops an unknown prop
passed to a custom component, no error, no effect. The actual bug: the
"Add Group" submit button sits in a `<CForm className="d-flex gap-2">`
next to a `CFormInput` - in a narrow enough container (a modal body is
the tightest case, `GroupsConfigModal.jsx`), the flex layout can squeeze
the button below its label's natural width, and a plain `<button>`'s
default `white-space: normal` lets "Add Group" wrap onto two lines,
doubling the button's own height against every sibling `size="sm"`
control in the same row.

Fixed at the actual source instead of the call sites: `text-nowrap`
added directly to the button inside `NamedListManager.jsx` itself - the
one place every consumer (`SettingsTab.jsx`'s three group lists,
`GroupsConfigModal.jsx`'s Node/Device Groups) shares, so no per-call-site
prop is needed at all. The three dead `className="text-nowrap"` props
removed from the call sites as part of this fix - restored those three
files to their prior committed content exactly (confirmed via `git
diff` showing zero changes left in them).

Verified live: rebuilt (`make up-all`), opened the Node Groups popup
(the narrowest/most reproduction-prone context) - "Add Group" renders
on one line, button height matches the adjacent input field. `eslint`
clean, console clean.

## 42. Message Levels redesign: beep count + repeat seconds + shared signal timing profile

Section 22's original Message Levels design only had `mode` (off/
constant/shortBeep/longBeep) and `period_deciseconds` (repeat cadence,
tenths of a second); the beep's own on-duration was a hardcoded pair of
constants in `activeBuzzer.ts` (`SHORT_BEEP_ON_DECISECONDS = 2`,
`LONG_BEEP_ON_DECISECONDS = 8`, section 27) - "invented defaults since
no real hardware/spec existed yet". This section replaces that with a
richer, fully admin-configurable model:

**Schema** (`message_levels`, migration
`1690000000041_add-beep-count-and-repeat-seconds-to-message-levels.ts`):
`period_deciseconds` renamed to `repeat_seconds` (`numeric(6,2)`, was
integer tenths-of-a-second) and a new nullable `beep_count` column
(1-4, `CHECK (beep_count IS NULL OR beep_count BETWEEN 1 AND 4)`) -
null for `off`/`constant`, required for `shortBeep`/`longBeep`. New
singleton table `message_signal_timing` (migration
`1690000000042_create-message-signal-timing-table.ts`, `id` pinned to
1 via `CHECK (id = 1)`) holds the beep-length/pause profile that used
to be `activeBuzzer.ts`'s hardcoded constants: `short_beep_seconds`,
`short_beep_pause_seconds`, `long_beep_seconds`,
`long_beep_pause_seconds` - one shared profile for the whole system,
not per level (confirmed with the user - the per-level choice is which
pattern plays and how many beeps, not how long any individual beep
lasts). Defaults (0.20/0.20/0.80/0.40s) preserve the old hardcoded
on-durations exactly, so nothing already configured changes sound the
moment the migration runs.

Postgres returns `numeric` columns as strings by default (`pg`'s own
precision-safety default) - these two migrations are the first
`numeric` columns in this schema, so `apps/api/src/db.ts` now registers
`types.setTypeParser(1700, parseFloat)` globally so every consumer
(`alarmPolicy.ts`, `activeBuzzer.ts`, `apps/ui`'s number inputs) gets a
real JS number, not a numeric string.

**Semantics** (confirmed with the user via `AskUserQuestion` before
implementing): `repeat_seconds = 0` means "play the burst once when the
alarm activates, then stay silent until the condition clears and
re-triggers" (edge-triggered) - not "repeat with no gap", which is what
`period_deciseconds = 0` used to mean under the old model. `> 0` means
the whole burst (all `beep_count` beeps) replays after that many
seconds, for as long as the condition stays active.

**Routes**: `routes/messageLevels.ts`'s PATCH body is now `{ mode,
beepCount, repeatSeconds }` - server nulls `beepCount` itself for
off/constant rather than trusting whatever the client sent, same
"server owns the not-applicable case" convention as heartbeat/data-
logger thresholds' own `level: null`. New `routes/
messageSignalTiming.ts`: `GET`/`PATCH /message-signal-timing`,
singleton row, partial-update PATCH (any subset of the four fields).

**`alarmPolicy.ts`/`activeBuzzer.ts`** (orchestrator): `AlarmPlan` now
carries `beepCount`/`repeatSeconds` instead of `periodDeciseconds`
(absent entirely for `constant`, which still needs no burst state at
all - held on directly, unchanged from before). `activeBuzzer.ts`
replaced its single `setInterval`-based pulse with a burst engine: a
`setTimeout` chain plays `beepCount` beeps (on for the style's
`_seconds`, off for the style's `_pause_seconds` between beeps, no
trailing pause after the last one), then either reschedules itself
after `repeatSeconds` (> 0) or stops and leaves `bursts` empty (=== 0).
Edge detection uses two maps: `bursts` (the live `setTimeout` handle,
keyed by process id) and `lastSignature` (the signature - mode +
beepCount + repeatSeconds + the four timing values - of the last burst
*started*, kept even after a one-shot burst finishes). Without the
second map, a finished one-shot burst would look identical to "never
started" on the next tick (its `bursts` entry is gone once done) and
would incorrectly replay every tick for as long as the condition
stayed active. A tick only starts a new burst when the signature
actually changes; an unchanged signature is left alone whether it's
still mid-burst, mid-repeat-wait, or already finished playing once.

**UI**: new shared helper `apps/ui/src/utils/messageLevel.js` -
`SELECTOR_OPTIONS` (the 10-entry combined off/constant/1-4 short
beeps/1-4 long beeps list, replacing the old separate mode dropdown +
period field), `encodeSelectorValue`/`decodeSelectorValue` (mode +
beepCount <-> one dropdown value), and `formatMessageLevel({ type,
mode, beepCount, repeatSeconds })` -> e.g. `"Warning 3 short beeps
(repeatable)"` / `"Error - Constant"` / `"Warning - Off"` (`once` when
`repeatSeconds` is 0, `repeatable` otherwise - the exact two words the
user specified). `MessageLevelsForm.jsx` rewritten around the combined
selector plus a seconds-format repeat input (disabled for off/
constant, same as the old period field) and a live preview column
using the new helper. New `MessageSignalTimingForm.jsx` (four seconds
inputs, commit-on-blur, same pattern as the repeat field) rendered to
the right of Message Levels via a new two-column `CRow` in
`SettingsTab.jsx` - Message Levels owns *which* pattern plays,
Message Signal Timing (right) owns how long a beep/pause lasts.

Per the user's own explicit ask, the helper is also used outside
Settings: `HeartbeatEditModal.jsx` and `DataLoggerEditModal.jsx`'s
"Level 1-4" pickers (previously bare `"Level N"`, no indication of
what picking it would actually sound like) now fetch `message-levels`
on mount and render `"Level N - {formatMessageLevel(...)}"` - e.g.
`"Level 2 - Warning 3 short beeps (repeatable)"` - falling back to the
bare label while `messageLevels` hasn't loaded yet or a row is
missing.

Verified live: rebuilt (`make up-all`), migrations ran clean, `numeric`
columns confirmed returned as real JSON numbers (not strings) via
direct `curl`. Configured warning/1 to "3 short beeps, repeat 2s" and
error/1 to "2 long beeps, repeat 3s" via the API, then polled
`/devices/3` (the Buzzer device) at 150ms resolution while the
`heartbeat-control-test` process's `simulate: true` switch drove a real
warning-then-error condition through `Heartbeating Control` - observed
the exact expected on/off timing for both patterns, and confirmed
error's `longBeep` correctly took priority over warning's `shortBeep`
(section 27's existing priority rule, unaffected by this redesign).
Separately confirmed the `repeatSeconds = 0` "once" semantics: switched
error/1 to `repeatSeconds: 0` while the condition was still active -
the burst played exactly once and then stayed silent for the remainder
of the (still-active) condition, no orchestrator errors. In the
browser: combined selector shows all 10 options correctly, live
preview text updates immediately on selection/typing before commit,
`HeartbeatEditModal`'s Level dropdown correctly shows the enriched
"Level N - ..." labels reflecting live Message Levels config, console
clean, `eslint`/`tsc --noEmit` clean on both `apps/api` and
`apps/orchestrator`, `alarmPolicy.test.ts`'s 7 tests updated for the
new shape and passing. Test config reset back to the original all-`off`
baseline afterward.

## 43. Target-project README: fix nexus-edge link broken on GitHub (local path reused as a public URL)

`templates/target-project/README.md`'s "built on nexus-edge" link and
its `docs/CREATING_A_TARGET_PROJECT.md` reference both reused
`NEXUS_EDGE_SOURCE_PATH` - a genuine local filesystem path
(`scripts/new-project.sh`: `realpath --relative-to="$TARGET_DIR"
"$NEXUS_EDGE_DIR"`, correctly needed for `.env`'s docker-compose build
context and the Makefile's version-drift check). Reused as a markdown
link target it breaks on GitHub in a non-obvious way: a target project
lives in its own separate repo, so a relative link like `../nexus-edge`
resolves against *that repo's own* blob URL - GitHub reads
`.../iot-nexus-edge-aquarium/blob/main/README.md` + `../nexus-edge` as
`.../iot-nexus-edge-aquarium/blob/nexus-edge`, i.e. "nexus-edge" gets
interpreted as a *branch name inside the aquarium repo*, not a path to
a different one. User caught this by the resulting broken URL showing
up in the rendered README.

Fixed by introducing a second, separate placeholder,
`NEXUS_EDGE_REPO_URL` - a real cross-repo URL, derived from this
checkout's own `origin` remote (`git remote get-url origin`, SSH form
rewritten to `https://`, `.git` suffix stripped; falls back to the
known public URL if there is no `origin`, e.g. a from-scratch tarball
checkout) - substituted alongside `NEXUS_EDGE_SOURCE_PATH`, which is
untouched everywhere else (docker-compose, `.env.example`, Makefile
version check - all still need the real local path). The doc-link line
now shows both: a `github.com/.../blob/main/...` link that works from
anywhere, plus the local path in parens for whoever's on the machine
that generated the project.

Same fix applied by hand to the two already-generated target projects
(`nexus-edge-aquarium/README.md`, `nexus-edge-smart-house/README.md`) -
their `NEXUS_EDGE_SOURCE_PATH`-derived `../nexus-edge` links replaced
with the same `https://github.com/anatolii-semochko/iot-nexus-edge`
URL; regenerating them via `make new-project` wasn't an option (would
discard real project state).

Verified live: ran `scripts/new-project.sh` against a scratch target
directory, confirmed the generated `README.md` carries the correct
`https://github.com/anatolii-semochko/iot-nexus-edge` link and the
`.../blob/main/docs/CREATING_A_TARGET_PROJECT.md` doc link, `sh -n`
clean, scratch directory removed afterward.

## 44. Elementary components library: first real category tree, icons, 4 new lightweight devices

Starter package toward the user's own wider goal ("пакет базових
пристроїв" - button/switch/encoder, sensors, actuators, indicator
LEDs/buzzers) - section 33's Library Catalog sync (`category.json` /
`library.json` / optional `icon.svg` per folder) already supported
nested categories in full, just unused until now (only the
`_synctest` fixture had ever exercised it).

**Category tree** - four new `devices/standalone/{input,sensor,
actuator,indicator}/category.json` folders (`{name, description}`,
matching `CategoryDescriptor`), populated by:

**Recategorizing all 6 existing devices** into them (`git mv`, content
untouched): `switch` -> `input/`, `temperature` -> `sensor/`,
`active-buzzer` -> `indicator/`, `light-regulator`/`heater`/`cooler`
-> `actuator/`. Real blast radius turned out wider than "just move
folders": `apps/ui/src/builtinDeviceTypes.js` has *static* imports
keyed to the old paths for `light-regulator`'s and `active-buzzer`'s
UI control/simulator components (`import ... from 'devices/standalone/
light-regulator/ui/control/...'`) - missing this would have broken
the UI build silently until someone opened a Devices page. Updated in
lockstep. Also swept every doc/comment "source of truth is
`devices/standalone/<old-path>`" pointer across `AGENTS.md`,
`README.md`, `docs/DEVELOPMENT_LOG.md`, two migrations, three
`apps/device-service/res/` YAML files, and the moved `active-buzzer`
device's own self-referencing `docs/README.md` - none of these break
anything if left stale, but a wrong "source of truth" pointer is
exactly the kind of thing that costs someone real time later.

**Icons** - schematic/IEC-style line-art SVGs (`#495057` stroke,
`stroke-width 3`, 64x64 viewBox, no `currentColor` - `LibraryBrowser.
jsx`'s `RowIcon` renders via a plain `<img src>`, which doesn't
inherit page CSS, so the color has to be baked into the file). Style
sample (switch + LED) shown to the user as a published Artifact before
producing the rest, per their own explicit ask ("хотів би для них
іконку - схемотехнічне зображення") - approved with no changes. One
`icon.svg` per device, all hand-drawn to read at both the actual
24px Library-table thumbnail size and enlarged: switch (open-contact
break + terminal dots), LED (diode wedge + cathode bar + emission
arrows), thermometer (capsule + bulb + tick marks), speaker+arcs
(active-buzzer), rheostat (light-regulator - resistor box + diagonal
arrow), zigzag resistor + heat waves (heater), snowflake (cooler),
momentary pushbutton (terminal dots + open bar + push arrow), sine
wave (analog), coil + switch contact (relay).

**4 new lightweight devices** - `input/button`, `sensor/analog`,
`actuator/relay`, `indicator/led`. Deliberately NOT the full 8-file
device-kind shape `switch/` etc. use (`contract.schema.ts`,
`edgex-device-profile.yaml`, `config/default-state.yaml`,
`safety.yaml`, `tests/README.md`) - confirmed with the user
("робимо мінімум... розширимо, коли будемо точно знати, чого
бракує"): none of these have real hardware yet, so building the full
machinery now would be ~8 files x 20 devices of pure boilerplate for
things nothing reads. Each gets just `library.json` (`{id, name,
description}`) + `icon.svg` + a short `docs/README.md` stub with a
`## Status` section explicitly marking it catalog-only and pointing at
`switch/` as the shape to graduate into once it has a real node/
process. `led` deliberately stays single-color - the original request
listed `led R`/`G`/`B`/`RGB` separately, but three copies of one
device with no real multi-channel contract isn't worth it yet; noted
in the doc as a deferred decision, not forgotten.

Device-detail drill-down (model, docs, links, images beyond the small
icon) explicitly deferred - the user hasn't decided the shape of that
yet either ("ще не визначився з стилем і деталями... розширимо, коли
будемо точно знати").

Verified live: rebuilt the `api` image (`devices/` is baked in at
build time, no bind mount), `POST /library/sync` -> `{categories: 4,
items: 11}` (10 devices + the pre-existing `example-thermal-node`),
confirmed every icon path resolves (`GET /library-assets/library/
standalone/<category>/<device>/icon.svg` -> 200) and renders correctly
in all four categories in the browser at real thumbnail size, `light-
regulator-01`'s device detail page still renders its control (the
moved-import risk), console clean throughout.

## 45. Alarm Annunciator - operator panel node/process, second sound-output consumer

An operator panel: 16 LED indicators (8 red/error + 8 yellow/warning,
one pair per Message Group "slot") plus its own buzzer, so an operator
can see which Message Groups have active warnings/errors at a glance,
without the UI. Confirmed with the user before building (plain-text
questions, not `AskUserQuestion` - its UI was hard to work with mid-
session): severity level does **not** change an LED's own behavior -
red/yellow are plain present/absent per group, all active groups lit
simultaneously; the buzzer alone reflects the fleet-wide highest
active level (unchanged Active Zummer policy). Test buttons are
**momentary and UI-only** - no physical Button device backs them; the
real panel hardware is only the 16 LEDs + buzzer. A bound-less slot's
Test button is disabled (explicit user follow-up, easy to miss:
"кнопки, які не прив'язані до групи - disabled").

**Library**: `devices/nodes/alarm-annunciator/` (`supports: [led,
active-buzzer]`, `bus.type: null` - virtual only, same as every other
node type today). `indicator/led` graduated from its catalog-only
entry (section 44) to the full 8-file device-kind shape - first real
consumer.

**Seed** (`1690000000043_seed-alarm-annunciator.ts`, one migration, ~50
lines of "array + loop" reusing `1690000000031_seed-example-thermal-
node.ts`'s own shape): 1 node row, 17 device rows (`annunciator-
error-1..8`, `annunciator-warning-1..8` - type `led`; `annunciator-
buzzer-01` - type `active-buzzer`, reuses the existing EdgeX profile,
no new one needed), 1 process row (`kind: 'alarm-annunciator'`,
`device_id` = the buzzer). `heartbeat_control`/`data_logger_control`
are explicitly set to the same rich defaults the 2026-08-01 backfill
migrations gave every already-existing row at the time - the bare
column-level default (`{}`) breaks any code path that reads
`.warning.level` unconditionally, which several already do.

**Config shape** (`processes.config`, generic `PATCH /processes/:id/
config` - no new route, same endpoint every other kind's settings
already use): `slots: [{redDeviceId, yellowDeviceId, messageGroupId}]`
x8 (device ids fixed at seed time, `messageGroupId` admin-editable via
a new `AnnunciatorEditModal.jsx`, matching `HeartbeatEditModal.jsx`'s
own "Edit" idiom) plus `testLevel`/`testSlotIndex` - the process
panel's own momentary test-button state, written through this same
route on mousedown/mouseup rather than a dedicated endpoint (a human
clicking, not a hot loop).

**Message Groups: first real reader.** Before this, `process_message_
groups` was pure inert metadata - nothing computed "does this group
have an active error/warning" (confirmed by research: the existing
buzzer/Active Zummer derives its alarm condition fleet-wide from every
process's `critical`/`warning`, never scoped by group). New route `GET
/message-groups/active-state` (`routes/messageGroups.ts`) does the
aggregation: for each group, does any member process (`process_
message_groups`) currently have `critical`/`warning` true (Redis, via
`processRegistry`). Same simplification the buzzer already makes: a
process's critical/warning flag carries no WEM level of its own, so a
real active flag always reads as level 1 - nothing produces a real
level 2-4 today. A held test button additionally contributes its own
operator-chosen level (1-4), which is the *only* way to exercise
levels 2-4 anywhere in the system right now.

**Shared burst engine** (`apps/orchestrator/src/soundOutput.ts`, new)
- extracted whole from `activeBuzzer.ts` (section 42's burst-pattern
engine) the moment a second sound-output consumer existed. One
function, `driveSoundOutput(processId, deviceId, plan)`, handles
constant/off/burst dispatch and the `bursts`/`lastSignature` Maps
(now keyed across every sound-output process, not just one) -
`activeBuzzer.ts` shrank to just computing its own fleet-wide
`AlarmPlan` and handing it off; `alarmAnnunciator.ts` does the same
with its own group-scoped plan. Neither file duplicates the pulse-
timer logic anymore.

**Per-tick logic** (`processes/alarmAnnunciator.ts`): for each of the 8
slots, `errorActive = group.hasActiveError || (thisSlotIsBeingTested
&& testLevel.type === 'error')` (same shape for warning) - writes both
LEDs unconditionally every tick (safe: `PUT /devices/:id/auto`
already dedupes unchanged reassertions in `log_command`, section 22's
2026-08-01 fix). Builds `{error: [...], warning: [...]}` level arrays
(real activity = level 1, held test = the chosen level) and calls the
*unmodified* `determineAlarmPlan` (`alarmPolicy.ts`) - the annunciator
needed zero changes to alarm-priority logic, only a different input.

**Real bug found and fixed along the way**: `GET /devices` started
returning `edgex: null` for the buzzer plus the last two LEDs right
after seeding - looked like a provisioning failure, but `core-metadata`
had all 17 devices registered and `UP` (confirmed directly). Root
cause: `apps/api/src/edgex.ts`'s `listEdgeXDevices()` called `/api/v3/
device/all` with no `limit` param - EdgeX's own default page size
(empirically 20) silently truncated the fleet once total device count
crossed it, something nobody had hit before this feature added 17
devices at once. Fixed with `?limit=-1` (EdgeX's own "no limit"
convention) - a real, previously-latent bug, not specific to this
feature's devices.

Verified live: full `make up-all` + one extra `api` rebuild for the
`limit=-1` fix, migration ran clean, all 19 devices (fleet-wide, not
just this feature's 17) confirmed `edgex.operatingState: UP` after the
fix. Created a real Message Group, bound Heartbeating Control's own
`critical` flag to it (the process that actually raises fleet
critical/warning - not `heartbeat-control-test` itself, a mistake
caught mid-verification, same confusion as a past session), bound
Alarm Annunciator's slot 1 to it, drove a real error via `heartbeat-
control-test`'s `simulate: true` and confirmed: slot 1's red LED
(device value) went `true`, the buzzer burst-toggled per the
configured `longBeep` pattern, unbound slots' LEDs stayed `false`.
Separately verified the test-button path directly (`PATCH testSlotIndex/
testLevel`): holding warning-tests slot 1 while its real error was
already active lit *both* red and yellow simultaneously; releasing
dropped yellow back to `false` while red (still really active) stayed
`true` - simultaneous-not-priority behavior confirmed exactly as
specified. Browser: process list shows "Alarm Annunciator", expanded
panel shows live-updating LED colors, disabled Test buttons on unbound
slots, Edit modal correctly lists/saves group bindings. Console clean,
`tsc --noEmit`/`vitest` clean on `apps/api` and `apps/orchestrator`.
All test state (message group, group membership, slot binding, message
level config, simulate flag) reset to baseline afterward.

## 46. CORE minimized to system-only processes; sound-output kinds move to target projects; process-settings/list UI consolidation

Follow-up to section 45, driven by the user's own framing of the CORE/
target-project split: CORE should stay "чистим і порожнім" (clean and
empty) - only genuinely system-level processes seeded here, everything
project-specific (which Message Groups matter, which rooms have
buzzers) belongs in the target project that actually has that context.
Confirmed narrowly before implementing (plain-text questions in
`AGENTS_TO_DO.md`, not `AskUserQuestion` - unusable for this user
mid-session, see below): **only the `processes` row and its
orchestrator runner move** - the Library node type (`alarm-
annunciator`) and every device instance (17 LEDs/buzzer for the
annunciator, the buzzer for Active Zummer) stay seeded in CORE, since
they're reusable hardware/library definitions, not project-specific
policy. Node->Device and Process->Node dependencies stay documentation-
only for now (not enforced), deliberately shaped so a future "Process
Library Import: process->nodes->devices" automation could read them
later - same for `node.yaml`'s `supports:` field.

CORE's `processes` table now seeds exactly 4 rows: Data Logger,
Heartbeating Control, Resource Monitor, Heartbeating control test.
Active Zummer (section 42) and Alarm Annunciator (section 45) both
moved to `nexus-edge-smart-house` as **plugin process kinds**, following
the extension-point mechanism `processPlugins.ts` already documented
(section 31/45's own note on it) - `plugins/active-buzzer/process.ts`
and `plugins/alarm-annunciator/process.ts`, each a near-verbatim port of
the deleted CORE files (`processes/activeBuzzer.ts`, `processes/
alarmAnnunciator.ts`, both removed from this repo entirely - no runner
left here for either kind). Removed via new migrations
(`1690000000044_remove-active-buzzer-process-unconditionally.ts`,
`1690000000045_remove-alarm-annunciator-process-unconditionally.ts`,
same unconditional-delete shape as section 30's temperature-control
removal, migration 035) - deletes only the `processes` row, node/device
rows explicitly untouched.

**Plugin context grew two new members.** Both moved processes need the
same beep-pattern/burst-timer engine and alarm-priority logic CORE
already has (`soundOutput.ts`'s `driveSoundOutput`/
`silenceSoundOutput`, `alarmPolicy.ts`'s `determineAlarmPlan`) - rather
than duplicate that logic per plugin, `processPlugins.ts`'s injected
context object (`apps/orchestrator/src/processPlugins.ts:48-54`) grew
from `{apiClient, logger}` to include all three, passed as plain
function arguments into every plugin's default export alongside
`register` - still zero imports from `@nexus-edge/orchestrator` itself,
for the same reason as before (confirmed again: a `package.json`
`exports` entry would not resolve at runtime for a plugin file mounted
outside the pnpm workspace's `node_modules` graph). A target project
that specifically wants tighter integration can still add a real `file:`
dependency on the package instead - this loader just doesn't require it.

**Message Groups renamed to "Message Casting Groups" - display label
only, scoped to `ProcessSettingsModal.jsx`.** Disambiguates from a
not-yet-built inverse ("Message Receiving Groups" or similar, for a
future process kind that reacts to a group's state rather than casting
into it - Alarm Annunciator is arguably already this shape, but its own
UI names it "slot bindings", not the group-membership language this
section covers). Deliberately NOT renamed anywhere else - the
underlying entity/table/route/field names (`message_groups`, `/message-
groups`, `messageGroupId`), and the Settings page's own card header,
are all unchanged (confirmed narrowly with the user: rename is scoped
to "у кожному попапі процесу", the popup only).

**`ProcessSettingsModal.jsx` consolidated into the single popup already
opened from a process row's first action button** - previously Alarm
Annunciator's slot bindings lived in a second, kind-specific modal
(`AnnunciatorEditModal.jsx`, opened from a gear button added to the
expanded panel) opened alongside the general Tab Groups/Message Groups
popup; the user asked for one popup only ("один основний попап з
конфігом... загальні стандартні опції, а після того блок унікальних для
процесу опцій"). `AnnunciatorEditModal.jsx` deleted; its slot-editing UI
now renders as an extra section below the standard Tab Groups/Message
Casting Groups pair, dispatched by process kind via a plain `kind ->
component` map (`EXTRA_SETTINGS_SECTIONS`, mirrors `ProcessesTable.jsx`'s
own `KIND_PANELS` idiom) - today only `alarm-annunciator` has an entry,
but the shape scales the same way that one does. State ownership needed
two passes to satisfy this codebase's stricter lint rules
(`react-hooks/set-state-in-effect`, `react-hooks/refs`): the extra
section owns its own `slots` state via a plain `useState` initializer
(safe because it only ever mounts while the modal is actually open, so
every reopen is a fresh mount - no reset effect needed), and writes its
latest edit into a parent-owned `slotsRef` only from the `CFormSelect`'s
own `onChange` handler (a ref write during a real event is always safe;
during render or inside an effect body, both got rejected live). The
parent's Save handler reads `slotsRef.current ?? process.config.slots`
- `null` means "untouched this session", a no-op write rather than data
loss - and `handleClose` resets the ref so a cancelled edit for one
process can never leak into a later save for a different one.

**`AnnunciatorPanel.jsx`** lost its gear button (config now lives
entirely in the consolidated popup above) and gained a mini
`BuzzerIndicator` for the process's own buzzer live state in its header
row next to the level selector - previously missing entirely, the
panel showed the 16 slot LEDs but nothing for the buzzer itself.

**New MINI indicator size** (`components/indicators/constants.js`):
`MINI_INDICATOR_SIZE = 30`, `MINI_BORDER_WIDTH = 3`, alongside the
existing full `INDICATOR_SIZE = 48`/`BORDER_WIDTH = 5`.
`StatusIndicator`/`BuzzerIndicator` both took optional `size`/
`borderWidth` props (defaulting to the full constants, so every existing
call site is unchanged) - `BuzzerIndicator`'s internal grille size is
now `size * 0.3` rather than a hardcoded module-level constant. Used at
the mini size in `AnnunciatorPanel.jsx`'s 16 slot LEDs (dense panel,
`radius 30px, border 3px` per the user's own spec) and the new buzzer
indicator above; used at the existing full size in the new Devices-list
expansion below.

**Nodes and Devices list pages gained expandable detail rows**, reusing
`useExpandableRows`/`ExpandToggleButton`/`ExpandAllToggleButton`
(section 39's hook, built for Processes and explicitly designed for
reuse) rather than anything new - `expandedIds` joined each page's own
`usePersistedState` defaults, a header-level `ExpandAllToggleButton`
sits next to "Actions". **Nodes**' detail row shows the raw node object
as formatted JSON (`JSON.stringify(node, null, 2)` - already have the
full row from the list, no extra fetch; user's own framing: "Поки що
показуємо стан ноди. Можеш показувати JSON. Потім будемо
допрацьовувати" - deliberately deferred, not a final design). **Devices**'
detail row (`DeviceDetailRow`) fetches the device once on expand
(`api.getDevice`, same "get once then overlay live" shape
`ActiveBuzzerPanel.jsx` already used) and overlays `useDeviceLiveState`
for the current value; renders a full-size `BuzzerIndicator`/
`StatusIndicator` for `active-buzzer`/`led` device types (matching what
Processes -> Active Zummer already shows), raw `String(value)` for
every other type for now (explicit user answer: "Показуй поки що сире
значення").

**Two more real, pre-existing bugs found live during this section's own
verification pass**, both fixed via new non-destructive migrations (CORE
via `node-pg-migrate`, smart-house via a new numbered `migrate-extra`
SQL file) rather than editing already-applied ones:

- **`ON CONFLICT (name)` idempotency mismatch** in smart-house's own
  `migrations/001_seed_thermal.sql`: `migrate-extra` re-runs every SQL
  file on every container start (section 31), so its seed INSERT must
  stay idempotent - but `name` is the user-editable display name, and
  these three devices had since been renamed via the UI ("Сенсор
  температури"/"Нагрівач"/"Охолоджувач"), so the old conflict target no
  longer matched and every restart attempted a fresh INSERT, colliding
  instead on the separate `devices_edgex_device_name_key` constraint -
  `nexus-edge-smart-house-migrate-extra` was crash-looping on this found
  live while seeding this section's own `house-buzzer-01`. Fixed by
  switching the conflict target to `edgex_device_name` (the stable
  identity column) in `001_seed_thermal.sql` and the new
  `002_seed_house_buzzer.sql`.
- **Nodes' `heartbeat_control` stuck at the bare `{}` column default**:
  migration `1690000000025_add-heartbeat-control-to-entities.ts`'s own
  backfill only covered `processes`/`devices` ("No nodes exist yet...
  nothing to backfill", true when written) - nodes created since
  (`example-thermal-node-01`, migration 031; `alarm-annunciator-01`,
  migration 043) inherited the bare default and were never backfilled.
  `GET /heartbeat-controls` already lists node-type entries alongside
  devices/processes, and `HeartbeatEditModal.jsx` reads `.warning.level`
  unconditionally - would crash for any node whose `heartbeat_control`
  is missing the key entirely (same bug class as the device-side gap
  section 45 already fixed once). Fixed with CORE migration
  `1690000000046_backfill-node-heartbeat-control-defaults.ts` and
  matching smart-house migration
  `005_backfill_thermal_node_heartbeat_defaults.sql` (same rich shape as
  migration 025's own backfill). Verified: CORE's node now shows a
  proper rich `heartbeatControl`; smart-house's backfill affected 3 rows
  (`thermal-node-01` plus two renamed rows), confirmed via `GET /nodes`.

Verified live end to end: full `make up-all` in both `nexus-edge` and
`nexus-edge-smart-house` (the latter needed a second full rebuild after
an earlier verification pass mistakenly only restarted `migrate-extra`,
leaving the UI container stale and the new settings-modal section
invisible until caught). CORE's Processes list shows exactly the 4
system rows. Smart-house's Processes list shows Active Zummer and Alarm
Annunciator, both running; opening Alarm Annunciator's settings shows
Tab Groups, Message Casting Groups, and the consolidated "Alarm
Annunciator - slot bindings" section together in one popup; the panel's
16 LEDs render visibly smaller than the Devices page's 48px indicators,
with a mini buzzer indicator next to the level selector. CORE's own Data
Logger settings popup confirms the rename displays correctly there too
("Message Casting Groups" with real checkboxes). Devices list expansion
shows live LED/buzzer indicators for the relevant device types. Both
tabs' consoles clean throughout.

## 47. Control Node - Raspberry Pi watchdog board (CORE library + first real CAN backend + Heartbeating Control for nodes)

`devices/nodes/control-node/` (AGENTS_TO_DO.md, 2026-08-09 "НОДА
КОНТРОЛЮ", spread across several rounds of Q&A - read that thread for
the full requirement derivation, this section is the distilled result).
An STM32F103C8T6 ("Blue Pill") + WCMCU-230 (VP230 chip, a pin-compatible
SN65HVD230 clone, 3.3V-native - corrected 2026-08-11 from an earlier
MCP2551 speculation once real hardware was in hand) board, mounted in
the same enclosure as the Raspberry Pi running NexusEdge, on the
enclosure's own CAN bus. Two entirely independent heartbeat directions,
both real for the first time in this platform:

- **Node -> NexusEdge** (does the board's firmware/link work?): a new
  `sensor/heartbeat` device type (a free-running `Uint32` counter,
  incremented once/sec by firmware) is the first real producer
  Heartbeating Control (section 28) has ever had for a *node* - that
  feature was process-only until now (its own runner's comment used to
  say so explicitly). Closing this gap needed real backend work, not
  just a config value: `apps/api/src/heartbeatControl.ts` gained
  `touchNodeHeartbeats`/`getNodeLastSeenAt`/`getNodeHeartbeatStopped`
  (node-typed siblings of the process-only functions already there),
  `routes/nodes.ts` gained `POST /nodes/heartbeat` (node-side
  counterpart of `POST /processes/heartbeat`) and now merges live
  `heartbeatStopped`/`heartbeatLastSeenAt` into `GET /nodes` the same
  way `routes/processes.ts` already did for processes.
  `apps/orchestrator/src/processes/heartbeatControl.ts`'s `runHeartbeatControl`
  now evaluates nodes too (refactored its process-only loop into a
  shared `evaluate()` helper called for both `apiClient.listProcesses()`
  and the new `apiClient.listNodes()|` - same `skippedTicks`/WEM logic,
  `stale_process_*`/`stale_node_*` WEM codes keep the two kinds from
  colliding). Bonus fix along the way: `nodes.last_heartbeat_at` (a
  legacy column from the original scaffold, already displayed by
  `NodesList.jsx` but never written by anything - a real pre-existing
  gap, not introduced here) is now populated by the same
  `touchNodeHeartbeats` call.
- **NexusEdge -> node** (does the control system have a pulse?): a new
  `actuator/pulse` device (`Bool`, written `true` every orchestrator
  tick) - the node's firmware watches for this arriving over CAN and
  drives its own 100% autonomous LED/buzzer/reset-attempt escalation
  entirely independent of NexusEdge, since the whole point is it must
  keep signaling even after NexusEdge itself has crashed. None of that
  escalation logic exists anywhere in this repo - it's firmware-only, see
  `devices/nodes/control-node/firmware/`.

**Why two new device types, not one "environment" device**: the target
sensor (AHT10/AHT20, chosen over the originally-proposed DHT11 for its
I2C hardware peripheral vs. DHT's fragile software-bit-bang timing) is
one physical chip reporting both temperature and humidity, but this
library's Device is atomic (section 30/32) - `sensor/temperature`
(reused as-is, its "Example" EdgeX profile branding is cosmetic, not
shown in nexus-edge's own UI) plus a new `sensor/humidity`, not a
compound device. A DS18B20 (1-Wire, temperature-only) is a temporary
bring-up stand-in before AHT10/AHT20 physically arrives - same
`sensor/temperature` device type, just a different firmware driver
(`config.h`'s `SENSOR_USE_AHT`), and the humidity device simply isn't
wired to anything real yet on that instance (`humidityDeviceId` absent/
null in the process's own config - see below).

**`input/button` graduated** from its catalog-only entry (library.json +
icon.svg + docs stub, section 44) to the full file set - the "Mute
Beeper" button is its first real consumer, same graduation `led`/
`active-buzzer` already went through for Alarm Annunciator (section 45).

**LED/buzzer got real Dev Simulator visuals for the first time** -
`LedControl`/`LedSimulator` (new) and `ActiveBuzzerSimulator` (new,
alongside the pre-existing `ActiveBuzzerControl`), registered in
`builtinDeviceTypes.js`. `led` gained an optional `capabilities.color`
hex hint (consumed by both `LedControl` and `DevicesList.jsx`'s own
inline `StatusIndicator` usage) so this node's green/yellow/red trio (and
any future instance) can render its actual intended color instead of
every LED in the app looking identical - backward compatible, absent
`color` still falls back to `StatusIndicator`'s existing default blue
(Alarm Annunciator's 16 LEDs unaffected). **Real bug found and fixed
live**: `DevSimulator.jsx`'s `CustomSimulator` branch always called
`handleSimulate` (the readOnly-only `.../simulate` endpoint) regardless
of the underlying device's own `readOnly` flag - worked by accident for
the one prior `CustomSimulator` (`light-regulator`) only because that
happens to be readOnly; broke immediately (400 "not read-only") the
moment a non-readOnly type (`led`, `active-buzzer`) got one. Fixed to
match the same `readOnly ? handleSimulate : handleWrite` branch the
generic `NumericStepper` path already used.

**`ProcessMetrics` generalized** (`apps/api/src/processRegistry.ts`,
`Record<string, number>` instead of a hardcoded `{cpu, ram, disk}`) -
`control-node`'s own `{temperature, humidity}` reading now shares the
exact same `POST /processes/:id/metrics`/live-broadcast path
`resource-monitor` (section 21) already established, not a parallel
mechanism.

**Where the process runner lives**: `nexus-edge-aquarium/plugins/
control-node/process.ts` (the target project owns the real instance's
behavior), *not* this repo - same split `temperature-control` already
established (AGENTS_TO_DO.md, 2026-07-29 "chistiy proekt"). Each tick:
writes `Pulse`, reads `Heartbeat` and touches the node's liveness only on
an actual value *change* (EdgeX's CAN transport caches "latest frame"
with no expiry - a value that never changes would misread as "still
alive" forever, see `sensor/heartbeat`'s own contract.schema.ts), reads
Temperature/(optional)Humidity for two-sided min/max/warnMin/warnMax WEM
checks (unlike resource-monitor's own ceiling-only thresholds - both a
floor and a ceiling matter for an enclosure reading). Config field names
are `env`-prefixed (`envTempMin`/`envTempMax`/...) specifically to avoid
colliding with resource-monitor's own plain `tempMax`/`tempWarnMax` on
the *same* `ProcessRecord.config` TypeScript type (a real duplicate-key
compile error caught during this session, not a hypothetical). **This
process kind's own detail panel** (`ControlNodePanel.jsx`, CORE's
`KIND_PANELS`) stays in this repo though, same precedent as
`TemperatureProcessPanel.jsx` - four steppers per metric (Warning/Error
× Min/Max), humidity row only rendered when the process's own config
actually has a `humidityDeviceId`.

**CAN backend - first real (non-`virtual`) physical device in this
project.** `apps/device-service`'s `physical`/`transport: can` backend
(`internal/driver/backend.go`, `internal/transport/can/`) was already
fully implemented but had never been exercised by an actual device
profile before this. This node's 9 devices are still seeded
`backend: virtual` in `nexus-edge-aquarium/extra-res/devices/
control-node-devices.yaml` for now (matching `example-thermal-node`/
Alarm Annunciator's own dev-first precedent) - concrete CAN arbitration
IDs are assigned and documented in `devices/nodes/control-node/
firmware/src/config.h` and `devices/nodes/control-node/docs/
wiring.md`, ready to copy into that device-list's `protocols.transport`
block once the board and its CAN transceiver are physically wired to the
enclosure's bus.

**Firmware** (`devices/nodes/control-node/firmware/`, PlatformIO +
STM32duino/Arduino framework, not raw CMSIS/HAL): `config.h` centralizes
every timing/pin/CAN-ID constant per explicit instruction ("ВСІ часові
таймери... ПРОПИШИ В КОНСТАНТИ"); `watchdog.cpp` is the core autonomous
state machine (`launched` flag latches true forever on first pulse, one
shared "time since last pulse" clock drives the `>2s` LED-alarm
threshold, the 1/2/3-minute buzzer escalation, and the 5/15/30-minute
forced-reset schedule - all as literal constants traceable to the
user's own spec in AGENTS_TO_DO.md); zero dependency on CAN/NexusEdge
being reachable, by design. **Written but not yet build/flash-tested
against real hardware** (Blue Pills hadn't arrived when this was
written) - see the firmware's own README.md for what to verify once they
do.

Verified live (the software/backend half only - no physical board
exists yet): full `nexus-edge-aquarium` stack (`make up-all`, alongside
nexus-edge's own already-running stack, container names/host ports
checked for collisions first per this package's own `../CLAUDE.md`
convention). Migration applied idempotently (`node/9 devices/process`
inserted, re-run-safe via `ON CONFLICT (edgex_device_name)` - not
`(name)`, the exact bug class documented on smart-house's own
`001_seed_thermal.sql` history). `device-service` registered all 9
devices with `core-metadata`. `GET /processes` showed the resolved
config (device ids, thresholds) and live `{temperature: 22, humidity:
45}` metrics. Simulated the `Heartbeat` counter changing twice via
`PUT /devices/:id/simulate` - `GET /nodes` correctly populated
`heartbeatLastSeenAt`/`last_heartbeat_at`; left it unchanged afterward
and confirmed Heartbeating Control correctly raised a critical WEM entry
("hasn't sent a heartbeat in N ticks") once past its 10-tick error
threshold, then confirmed it cleared on the next simulated change.
Dev Simulator: clicking the green LED/buzzer rows now shows the correct
green/red color (not a generic checkbox, and not a 400 error - the
readOnly-branch bug above was caught by this exact click). Control
Node's own detail panel renders both metric rows with the seeded
threshold defaults. Console clean throughout.

## 48. Partial physical network - live physical/simulated redirect per Node or standalone Device

AGENTS_TO_DO.md, 2026-08-09/10 - lets a Node (or a standalone Device,
`node_id IS NULL`) be switched between its physical EdgeX identity and
an opt-in simulated twin, **live**, from the UI. Directly revisits
section 6's own "physical/virtual is config-time only, not a live UI
toggle... nobody actually needs day-to-day" call - a second real need
showed up (dev/prod bench-testing: some nodes physically on the bench,
others simulated, switching which is which without a redeploy) - but
does **not** touch that flag or `apps/device-service`'s own config-time
`backend` resolution at all. This is a deliberately separate, additive
axis living entirely in `apps/api` - `backend.go`'s own hot-swap-safety
reasoning stays exactly as valid as it always was for what it actually
governs.

**Why not two Postgres device rows** (the earliest shape considered):
would double Node/Device Group membership, fragment
`log_command`/`log_device` history across a switch, and force every
list view to somehow show "which of these two rows is the *real* one"
right now. Real finding that made the alternative cheap instead:
`dualDevicesModel.publishReading`/every other bus-facing call already
keys everything off the stable Postgres `device.id`, never the EdgeX
device name - nothing downstream (UI, the live WS feed, a process's own
`apiClient.getDevice(id)`) has ever seen an EdgeX name at all. So one
row, two possible EdgeX identities, redirect only where the name is
actually resolved:

- **Schema** (migration `1690000000048_add-simulated-mode`):
  `nodes.simulated boolean`, `devices.simulated boolean`,
  `devices.edgex_device_name_simulated text` (nullable). `simulated`
  only carries independent meaning for a standalone device - a node-
  attached one always defers to its own node's flag instead (the
  switching granularity the user asked for: "для нод і пристроїв-
  сиріт", not per-device-within-a-node). "Opt-in" needed no separate
  flag - a device with no twin provisioned (`edgex_device_name_simulated`
  null) simply has nothing to redirect to.
- **Resolver** (`routes/devices.ts`'s new exported `resolveEdgexName`):
  one function, called everywhere `device.edgex_device_name` used to be
  read directly (~8 call sites - `GET /devices`, `GET /devices/:id`,
  the four write paths via a generalized `requireEdgeXDevice` returning
  `resolvedEdgexName`, `POST /devices/:id/log`, and the Model State
  Validator's own sibling-device reads in `checkForbidden`). Needed a
  `SELECT_DEVICE_WITH_NODE` join (`devices` LEFT JOIN `nodes` for
  `node.simulated`) alongside the existing `SELECT_DEVICE_LIST_BASE`,
  since `findDevice`/`findDeviceByNodeAndName` previously queried
  `devices` bare, with nothing to resolve a node-attached device's
  *effective* simulated-ness against.
- **API**: `PATCH /nodes/:id/simulated` (rejects turning simulated on
  when not one single child device has a twin - otherwise it would
  silently be a no-op, indistinguishable from a bug) and
  `PATCH /devices/:id/simulated` (rejects outright for a node-attached
  device - "toggle the node's own simulated mode instead", not a
  silent no-op either, since `resolveEdgexName` never even reads that
  device's own column once it has a `node_id`). Both `requireAuth`;
  `log_command`'s own `action` CHECK constraint gained `'simulated-on'`/
  `'simulated-off'` (same migration) - the node-level entry has no
  `device_id`/`process_id` to attach to (that table has no `node_id`
  column, not added in this pass), so its `value` just carries the
  node's own id/name instead of being omitted entirely.
- **UI**: a compact `IconButton` (swap-horizontal icon, `secondary`/
  outline when physical, `info`/solid when simulated, disabled when no
  twin exists) on `NodesList.jsx` and `DevicesList.jsx` (standalone rows
  only - hidden entirely, not shown-disabled, for a node-attached
  device), placed between the existing Settings (gear) and Expand
  buttons per the user's own explicit placement ask. `GET /nodes` grew
  a computed `has_simulated_twin` (`EXISTS` subquery against `devices`)
  so the list view can disable/enable the switch without a second
  per-row fetch, same "resolve everything the list needs in one query"
  idiom `SELECT_DEVICE_LIST_BASE` already established for Devices.

**Explicitly deferred, per the user's own direction** (confirmed
2026-08-10, "сервісний режим... на відповідальність інженера"), not
forgotten:
- **No safety guard on switching an actuator mid-command.** Flipping a
  node from physical to simulated while it's actively driving real
  hardware leaves the physical side exactly where it last was - nothing
  forces a safe/neutral value on the way out. Left as a hook point for
  a future guard (possibly firmware-side too, per the user), not built
  now.
- **No value-continuity seeding.** A freshly-simulated twin does not
  inherit the physical side's last reading - confirmed live (see
  below): switching a temperature device from physical (22°C) to
  simulated (30°C, the twin's own separately-seeded value) is a real
  discontinuity, deliberately left as an engineer-managed concern.

Verified live end to end on `control-node-01` (nexus-edge-aquarium) -
provisioned two representative simulated twins (`control-node-led-
green-sim` Bool, `control-node-temperature-sim` Float32 - deliberately
different seeded values, 22°C vs 30°C / false vs true, specifically so
switching is visually unambiguous), linked via a plain `UPDATE` in
`001_seed_control_node.sql` (not part of the base `INSERT`, so which
devices get twins stays independent of the base seed). Real bug caught
and fixed during this verification: `SELECT_DEVICE_LIST_BASE`'s new
`n.simulated AS node_simulated` column broke both of its own `GROUP BY
d.id, n.name` call sites (`42803`, Postgres requiring every selected
non-aggregate column in the `GROUP BY`) - `GET /devices` returned a raw
500 until both were extended to `GROUP BY d.id, n.name, n.simulated`.
Confirmed via curl: `GET /devices/13` read `22` before toggling
`control-node-01` to simulated, `30` immediately after, with no restart
and no change to the request itself. Wrote `false` to the LED while
simulated, switched back to physical, and confirmed the physical side's
own value was untouched (`false`, its own pre-existing state, not
overwritten by the simulated-side write) - twin isolation working as
designed. Confirmed both rejection paths (`PATCH .../simulated` on a
node-attached device; `PATCH /nodes/:id/simulated` with no twin
anywhere - exercised via `alarm-annunciator-01`, which has none). In
the browser: `NodesList.jsx`'s switch went solid blue on toggle, gray
again on toggle-back, `alarm-annunciator-01`'s own switch stayed
disabled throughout (no twin provisioned for that node at all).

**Visual polish follow-up (2026-08-10):** the IconButton toggle above
was replaced with the existing `Switch` component (gray/`#d3d3d3` when
physical, red/`#e55353` when simulated - not the earlier blue "info"
state) on both `NodesList.jsx`/`DevicesList.jsx`, and a simulated row
(main row *and* its own expanded detail row) now gets `color="warning"`
- the same contextual-row-tint convention already used elsewhere for
critical/warning state. `DevicesList.jsx`'s tint uses a computed
`effectivelySimulated` (`node_id === null ? device.simulated :
device.node_simulated`) so a node-attached device tints correctly by
its *parent's* flag, not its own always-`false` column. Both list pages
also gained the same `border-bottom-0`-when-expanded idiom
`ProcessesTable.jsx` already used (removes the line between a row and
its own expansion) - a plain visual-consistency request, unrelated to
simulated mode itself, done at the same time since both list pages were
already being touched.

**Investigated separately, not a bug:** enabling `simulated` on
`control-node-01` and immediately seeing Heartbeating Control flag it
critical ("hasn't sent a heartbeat in 11833 ticks") turned out to be
unrelated to the toggle - `control-node-heartbeat` has no simulated
twin at all, so `resolveEdgexName` returns its physical name either
way. The real cause: restarting `device-service` earlier in this same
session (to load the two new `-sim` device-list entries) reset every
virtual device's value back to its own YAML `initial.X`, including
`Heartbeat` back to `0` - and nothing auto-increments it in this all-
virtual dev setup except a manual `.../simulate` call, so it had simply
sat stale for the ~3.3 hours since. Confirmed live: a fresh simulated
write to `Heartbeat` cleared the alarm instantly with `simulated` still
on. Real firmware (once flashed) increments this every second on its
own, so this specific staleness mode won't recur outside this all-
virtual bring-up state.

**Correction (2026-08-10) - that diagnosis was incomplete.** The user
reported the same alarm recurring minutes later, still with `simulated`
on - correctly pointed out this needed a real fix, not just an
explanation. The actual gap: `simulated` mode is meant for bench-
testing/service state (the user's own framing, "сервісний режим") -
a node in that state has, by definition, no real hardware link for a
heartbeat to arrive on, so `heartbeatControl.ts`'s own staleness check
was raising a **permanent, un-actionable** alarm for any node currently
simulated, not a transient one that would self-resolve. Fixed:
`NodeRecord` (orchestrator `apiClient.ts`) gained `simulated`;
`heartbeatControl.ts`'s shared `evaluate()` now skips any entity with
`simulated: true` outright, before even checking `stoppable`/
thresholds - a node's own heartbeat is simply not evaluated at all
while simulated, the same way `stoppable` already exempts an entity
from evaluation, just on a different, orthogonal condition. Verified
live both directions: switching `control-node-01` to `physical` while
its `Heartbeat` device was still stale correctly re-raised the same
error immediately; switching back to `simulated` correctly suppressed
it again, staying clear well past the point it would otherwise have
tripped.

## 49. Control Node firmware - first real hardware milestone (build + flash succeed)

2026-08-10/11 - the user's Blue Pill and ST-Link V2 (clone, `A73-
STLINK-V2`) arrived; this is the first point section 47's firmware
(`devices/nodes/control-node/firmware/`, written untested) actually met
real silicon.

**Toolchain, from nothing to a working flash, in order:**
- `stlink-tools` (apt) for `st-info`/basic SWD probing - confirmed the
  ST-Link enumerates over USB but `st-info --probe` initially failed
  without `sudo` (`access error`) even though the package's own udev
  rule (`MODE:="0666"`) was already correct - the board had been
  plugged in *before* the package installed that rule, so it never
  retroactively applied; an unplug/replug (or `udevadm control
  --reload-rules && udevadm trigger`) fixed it. Confirmed device:
  `STM32F1xx_MD`, chipid `0x410`, 20KB SRAM, **128KB flash** - not the
  nominal 64KB a "C8T6" implies, a well-documented trait of many C8T6
  clones actually carrying a CBT6 die underneath; harmless bonus, not
  something this firmware currently relies on (still builds against
  the board definition's own 64KB figure).
- PlatformIO Core, via the official `get-platformio.py` installer
  (isolated venv at `~/.platformio/penv`, no system Python pollution,
  no `sudo` needed for the installer itself) - needed `python3.12-venv`
  (apt, `sudo`) first, the installer fails cleanly with that exact
  instruction if it's missing.

**Real build bug, found and fixed**: `pio run` failed compiling the
STM32_CAN library - `CAN_HandleTypeDef`/`CAN_BS2_*TQ`/`HAL_CAN_*`
symbols all "not declared", `struct stm32_can_t` reported as having no
`handle` member. Root cause: STM32duino's default HAL config
(`stm32f1xx_hal_conf_default.h`) does define `HAL_CAN_MODULE_ENABLED`,
but only when nothing overrides it - this board/library combination
needed it forced explicitly via `platformio.ini`'s `build_flags`
(`-D HAL_CAN_MODULE_ENABLED`) rather than relying on the default path;
the STM32_CAN library's own header (`STM32_CAN.h`) documents this exact
flag as the fix in a comment, once you know to go looking for it. Not
a design flaw in this firmware's own code - a real gap in how the
STM32_CAN library documents its own prerequisites, same "real bug
caught live" pattern as everything else in this journal.

**Real hardware correction**: the CAN transceiver actually in hand is a
WCMCU-230 (VP230 chip, pin-compatible SN65HVD230 clone, 3.3V-native) -
not the MCP2551 (5V part) speculated in section 47/`docs/wiring.md`
before hardware existed. `docs/wiring.md` and `node.yaml` corrected;
arguably a better fit for this board than a 5V transceiver would have
been anyway (no logic-level mismatch to reason about between the Blue
Pill's own 3.3V I/O and the transceiver's TXD/RXD).

**Verified so far**: `pio run` builds clean (RAM 7.7%/1568B, Flash
44.5%/29180B against the nominal 64KB figure). `pio run --target
upload` via `openocd`+`stlink`: "Programming Started" -> "Programming
Finished" -> "Verify Started" -> "Verified OK" -> "Resetting Target".

**Not yet verified**: the firmware was flashed to an otherwise-unwired
chip (no LEDs/buzzer/sensor/CAN transceiver connected yet at flash
time) - only "builds, flashes, resets without hanging" is confirmed,
not any of `watchdog.cpp`'s actual behavior. Next planned check (not
yet done): wire a single LED to PA1 (yellow) and confirm a ~1Hz blink,
proving the state machine genuinely runs in real time before wiring
the rest of the board.

## 50. Control Node - pulse/heartbeat switched to real CAN, container CAN access, a profile/device update gotcha

2026-08-13 - continuing from section 49, with the board now on a real
CAN bus reachable from the dev host via a Y4126-CAN-PRO-2 USB-CAN
adapter (enumerates as `0c72:000c PEAK System PCAN-USB`, a compatible
clone; picked up by the kernel's own `peak_usb` driver, exposed as
plain SocketCAN `can0` - no vendor software needed).

**Two of the node's nine devices switched from `virtual` to
`physical`/CAN** - `control-node-pulse` and `control-node-heartbeat`
only (`nexus-edge-aquarium/extra-res/devices/control-node-devices.yaml`),
deliberately not the other seven (LEDs/buzzer/sensor/button), whose own
physical wiring/bench-testing hasn't happened yet. Each device now
carries `protocols.transport: {type: can, bus: can0}`; the CAN
arbitration ID itself (`canId: "0x300"`/`"0x301"`) was added to the
`NexusEdge-Pulse`/`NexusEdge-Heartbeat` **profiles**
(`devices/standalone/actuator/pulse/`,
`devices/standalone/sensor/heartbeat/`, plus their baked
`apps/device-service/res/profiles/` copies) - confirmed by reading
`internal/transport/can/mapping.go`/`transport.go` directly that
`canId`/`byteOffset` resolve from the EdgeX device **profile's**
resource attributes (`req.Attributes`, populated by device-sdk-go from
`DeviceResource.Attributes`), not from anything per-device-instance.
This is a real, load-bearing limitation worth flagging: **a profile
shared by multiple device instances can only ever have one CAN mapping
for all of them.** `NexusEdge-Pulse`/`NexusEdge-Heartbeat` are safe
today (control-node is the only device using either profile anywhere in
the package), but `NexusEdge-Led` is not - it's shared by all three of
control-node's own LEDs (green/yellow/red), which the real firmware
distinguishes only by `byteOffset` within one shared CAN ID (`0x303`).
Going physical for the LEDs as currently modeled would make all three
resolve to the same mapping. Not fixed now (LEDs are still virtual) -
whoever does that migration will need either per-instance profiles
(`NexusEdge-Led-Green`/`-Yellow`/`-Red`) or a code change letting
`protocols.transport` on the device instance override/supplement the
profile's attributes. The `control-node-devices.yaml` file's own
original comment claiming `canId`/`byteOffset` belonged on the
per-device `protocols.transport` block (written before this transport
code existed) was simply wrong and has been corrected in place.

**Gotcha found live: editing a profile/device YAML on disk does nothing
to an already-seeded EdgeX instance.** device-sdk-go's own bootstrap
only creates a profile/device if the name doesn't already exist yet -
restarting `device-service` after editing `NexusEdge-Pulse.yaml` logged
`"Device Profile NexusEdge-Pulse exists, using the existing one"` and
genuinely left the live profile (verified via `GET
/api/v3/deviceprofile/name/NexusEdge-Pulse` against core-metadata,
`127.0.0.1:59982` on this dev host) with no `canId` attribute at all.
Same story for the device's own `protocols` block. Fixed by pushing the
change directly against core-metadata's own API instead of relying on
device-service's own seed-on-boot path:

```
curl -X PUT -F "file=@apps/device-service/res/profiles/NexusEdge-Pulse.yaml" \
  http://127.0.0.1:59982/api/v3/deviceprofile/uploadfile

curl -X PATCH http://127.0.0.1:59982/api/v3/device -H "Content-Type: application/json" \
  -d '[{"apiVersion":"v3","device":{"name":"control-node-pulse","protocols":{...}}}]'
```

(`PATCH /api/v3/device` needed a top-level `"apiVersion":"v3"` sibling
of `"device"` - EdgeX's `Versionable` embed - a 400 without it, easy to
miss.) Worth remembering for any future edit to an already-seeded
device/profile, not just this one - the "safe" path of just editing the
YAML and restarting the container only actually works for a *brand
new* device/profile name that's never existed before.

**Container access to the real CAN bus**: discussed two options with
the user - `network_mode: host` for the `device-service` container
(the textbook Docker+SocketCAN pattern) vs. moving just the `can0`
interface into that container's own network namespace. Investigating
`device-service`'s actual startup path
(`CMD ["./device-service", "-cp=keeper.http://edgex-core-keeper:59890",
"--registry"]`, `docker-compose.edgex.yml`) showed `network_mode: host`
would be far more invasive than it first looked: it resolves
`edgex-core-keeper` (and, via keeper's own shared config, core-metadata/
core-data/core-command/the message bus) purely by compose-network DNS
name, none of which exist under host networking - fixing it would mean
republishing several currently-internal-only ports across at least
four other compose services (one, `edgex-core-metadata`, is already
published but on a *remapped* host port, `59982`, which would need to
become `59881` to line up) plus `extra_hosts` entries pointing every
one of those names back at `127.0.0.1`. The netns-move option touches
none of that - `device-service` keeps its normal compose network for
everything else, gains only the one interface. Chosen. Implemented as
`nexus-edge-aquarium/scripts/attach-can-bus.sh` (+ `make
attach-can-bus`) - `sudo ip link set can0 netns <device-service's PID>`
then bitrate/up inside that namespace via `nsenter`. Deliberately not
wired into `up-all`/`edgex-up` - CAN hardware isn't present on every
dev machine or every target project.

**Correction, live-verified same day**: the "a plain `docker restart`
reuses the existing netns" assumption above turned out to be wrong for
this container - restarting `device-service` returned `can0` to the
*host*'s root namespace (confirmed by seeing it reappear there), not
just any full recreate. So `make attach-can-bus` needs re-running after
*any* container restart, not only `--force-recreate`/rebuild/`down`+
`up` as originally guessed - a smaller but real correction to the
tradeoff that led to picking this approach; still meaningfully less
invasive than `network_mode: host` would have been.

**A second gotcha found during the same live test**: `device-service`'s
`busConn` (one cached raw CAN socket per interface name, opened lazily
on first use, "no expiry" by design - see `internal/transport/can/
bus.go`) went stale after `can0` was moved out of and back into the
container's namespace for diagnostics (to isolate a wiring problem from
a container problem - see below). The cached socket kept accepting
writes into a void and errored on send with `no such device or
address`, silently, until `device-service` itself was restarted to open
a fresh socket against the now-stable interface. Anything that
manipulates `can0`'s namespace after `device-service` has already
opened it needs a `docker restart nexus-edge-aquarium-device-service`
afterward, every time - not just once at initial attach.

**End-to-end live verification, 2026-08-13**: with `control-node-pulse`/
`control-node-heartbeat` on `physical`/CAN and `can0` correctly attached
to the container's namespace, `candump` inside the container showed
NexusEdge's own `CAN_ID_PULSE` (0x300) writes reaching the bus
continuously and the board's `CAN_ID_LEDS` mirror (0x303) settling into
`00 00 00` (green blinking/off between blinks) rather than cycling back
to `Booting`/`PulseLost` - the full physical loop closed with no manual
`cansend` involved, matching section 49's "next step" exactly. One
red herring along the way, worth remembering for next time: an
apparent zero-RX/zero-errors dead bus (rx_packets stuck at 0, no
errors at all) turned out to be a real loose/miswired CAN connection on
the user's bench, not a software problem - confirmed by testing `can0`
directly on the host (bypassing the container/netns entirely) before
and after the physical fix, which is a good general bisection technique
for "is this the software or the wire" on this kind of setup.

**Also found stale and fixed**: `nexus-edge-aquarium/migrations/
001_seed_control_node.sql`'s own `backend` column for these two devices
(hardcoded `'virtual'` at INSERT time) - purely informational/UI-facing
(the actual EdgeX-side switch is what's described above), but was
showing `virtual` in the Devices API/UI despite the real backend now
being physical. Fixed in the migration file for future/fresh
deployments, and via a direct `UPDATE devices SET backend = 'physical'
WHERE edgex_device_name IN (...)` against the already-seeded row, since
this migration's own `ON CONFLICT DO NOTHING` idempotency (by design,
see the migration's own header) means editing the migration file alone
never retroactively touches a row that already exists - the same
"editing the source doesn't touch an already-seeded/already-created
thing" shape as the EdgeX profile/device gotcha above, just one layer
further out (Postgres, not EdgeX metadata).

## 51. Control Node - buzzer crackle bug, LEDs/buzzer live-verified, passwordless attach-can-bus

2026-08-14 - LEDs and the buzzer wired to real peripherals and
confirmed working ("Світлодіоди і функціонал STM32 працюють супер").

**Real firmware bug found and fixed**: the buzzer crackled/broke up
periodically while sounding, on every stage. Not a hardware quirk -
`buzzer.cpp`'s `buzzerUpdate()` called `tone()`/`noTone()`
unconditionally every time it ran, and it runs every `loop()`
iteration with no throttling (`main.cpp` calls it unconditionally each
pass). STM32duino's `tone()` resets the underlying hardware timer on
every call; at `loop()`'s effectively-unbounded rate that reset the
waveform hundreds to thousands of times a second, audible as a crackle
riding on top of the actual tone. Fixed by tracking the currently-
playing frequency in a static and only calling `tone()`/`noTone()`
again when the target actually changes (0 Hz = silent) - one small
`setTone()` helper, same idea in all three stages (short beep, long
beep, the two-tone continuous alarm). Rebuilt, reflashed via ST-Link,
user-confirmed crackle gone on all three stages.

**Passwordless `make attach-can-bus`**: the script from section 50
needed the user to type a sudo password on every single invocation
(every device-service restart, per that section's own correction).
Split it in two rather than granting blanket `NOPASSWD` on raw `ip`/
`nsenter` (a much coarser grant - any local process could then remap
network namespaces without a password): `scripts/attach-can-bus.sh`
stays unprivileged (resolves the container PID, no sudo of its own),
`scripts/attach-can-bus-root.sh` is the entire privileged surface (the
actual `ip link .../nsenter` calls), invoked via exactly one `sudo`
call. A `/etc/sudoers.d/attach-can-bus` drop-in
(`visudo -f /etc/sudoers.d/attach-can-bus`, never edit sudoers files
directly - a syntax error there can break `sudo` system-wide) grants
`NOPASSWD` for that one script path only:

```
anatolii ALL=(root) NOPASSWD: /home/anatolii/Projects/iot/nexus-edge-aquarium/scripts/attach-can-bus-root.sh
```

The sudoers rule is per-machine/per-user setup, not something committed
anywhere - `visudo` catches syntax errors before saving (confirmed live:
a `NOPASWD` typo, missing the second S, was caught and re-prompted for
a fix rather than silently breaking sudo).

## 52. Process management - a Library catalog for process kinds, live create/delete, "pending restart"

2026-08-14 - two gaps the user raised together: (1) `processes` rows
could only ever be added/removed via a hand-written seed migration, no
live management surface at all; (2) there was no discoverable catalog
of reusable process *kinds* the way `devices/` already is one for
device/node types - a target project wanting a new process kind had to
write one from scratch, copy-paste from another target project, or
know CORE's own `apps/orchestrator/src/processes/*.ts` existed at all.

**Design choice, per the user's own framing ("каталог має бути в
Library")**: rather than a parallel catalog system, `library_categories`/
`library_items` (section 32) gained a third `kind = 'process'` value
alongside the existing `device`/`node`, sourced from a new
`devices/processes/` tree (same `library.json`/`category.json`/
`icon.svg` conventions, same sync-on-startup + `POST /library/sync`
mechanism, `libraryCatalog.ts`'s `walk()` just gained a third top-level
call) - no new Postgres tables, no new Dockerfile `COPY`, no new static
mount; `devices/` already gets baked into the api image and already
serves `/library-assets/library/*`. `usedTypeNames()` for kind
`"process"` joins against `processes.kind` (already exactly the right
column) instead of `devices.type`/`nodes.type`.

**One example catalog entry**: `devices/processes/example-threshold-
monitor/` - a real, working (not fake) starter template: watches one
Device against a two-sided min/max/warn range, same shape as CORE's own
`resourceMonitor.ts` and control-node's own `process.ts`, reduced to one
generic device. Explicitly labeled "(template)" - deliberately not a
migration of any real target-project process (control-node,
temperature-control, alarm-annunciator, ...) into the catalog, which
would be a separate, larger, per-process risk/sign-off decision, not
bundled into this infrastructure change.

**Live CRUD** (`routes/processes.ts`, both `requireAuth`): `POST
/processes` (name, groupId, type, kind, actions, deviceId, config) and
`DELETE /processes/:id` - deliberately unrestricted, no special-casing
"official"/`permanent` kinds, same "no special-casing" principle
`processRegistry.register()` itself already follows. Both are fully
live with no restart needed for a `kind` whose plugin is already
loaded: `server.ts`'s `tick()` calls `apiClient.listProcesses()` fresh
every tick (no caching), so a new row starts being ticked, or a deleted
one stops, within about a second either way.

**What's NOT live**: a `kind` whose plugin code isn't loaded in the
running orchestrator yet. `registerBuiltinProcessKinds()`/
`loadProcessPlugins()` (section on extension points, `processPlugins.ts`)
both run exactly once, right before `setInterval(tick, ...)` starts -
no periodic re-scan. A row created for a brand-new kind just sits
inert (`processRegistry.get(kind)` returns `undefined`, `tick()`
silently skips it, no error) until the orchestrator container restarts.

**"Pending restart" signal**: `processRegistry.list()` (orchestrator,
new) exposes currently-loaded kind names via a new `GET /process-kinds`
on orchestrator's own Fastify app (previously only `/health` existed).
`apps/api` proxies this at `GET /processes/registered-kinds`
(`config.orchestratorUrl`, defaults to the compose-network hostname:port,
`http://orchestrator:${ORCHESTRATOR_PORT}`) - tolerant of orchestrator
being briefly unreachable (mid-restart is exactly when this gets
called), returns `{kinds: [], unreachable: true}` rather than failing.
`ProcessesList.jsx` polls it every 10s (`REGISTERED_KINDS_POLL_MS`,
independent of orchestrator's own 1s tick) and passes `registeredKinds`
down to `ProcessesTable.jsx`'s `ProcessRow` - a row whose `kind` isn't
in that list gets the same `warning` row tint the Devices/Nodes pages
already use for simulated mode, plus a "Pending restart" badge next to
its status. Clears itself within one poll interval of the actual
restart, no manual page reload needed.

**Real bug found live, not obvious in advance**: the very first attempt
at `GET /processes/registered-kinds` consistently timed out (2s, then
5s) with `TimeoutError`, even though a bare `node -e` fetch to the
exact same URL from inside the same running container resolved in
~50ms every time. Root cause: Node's default libuv threadpool (4
threads) - `getaddrinfo` (what a hostname-based `fetch()` needs)
queues on it same as filesystem I/O, and `apps/orchestrator`'s own
steady per-second tick traffic hitting this same `apps/api` process
(dozens of concurrent requests/sec, `critical`/`warning`/`metrics`/
`messages`/heartbeat calls from 4+ CORE processes alone) was enough to
starve that queue under real load - a standalone script with no other
threadpool contention never saw it. Fixed with `UV_THREADPOOL_SIZE: 64`
on the `api` service (nexus-edge's own `docker-compose.yml`, the
`templates/target-project/` template, and nexus-edge-aquarium's already
existing compose file - all three, confirmed live only in the first).
Not unique to this one route - any future outbound `fetch()`-by-hostname
added to `apps/api` would have hit the identical queueing under the
same load; this fix covers all of them, not just this one call.

**Tooling**: `scripts/add-process-kind.sh` (+ `make add-process-kind
KIND=... TARGET=... [NEW_KIND=...]`) copies a catalog entry's
`process.ts` into a target project's own `plugins/<kind>/`, best-effort
renaming the `register("...")` call's own kind string when a
`NEW_KIND` is given. Filesystem-only - the `processes` row itself is
created separately (the Library page's own "Add process" modal, or
`POST /processes` directly), and an orchestrator restart is still
needed afterward, same as always.

**UI**: `LibraryBrowser.jsx` gained a third `Processes` tab (`KINDS`
array, otherwise generic/unchanged) plus an `AddProcessModal` shown for
process-kind items only - name/group/type/deviceId/config(JSON) form,
`POST /processes` on submit. Config is a raw JSON textarea, not a
per-kind dynamic form - each kind's own `docs/README.md` documents its
own shape (see the example entry's), and building a generic
jsonb-schema-driven form editor would be real extra work for something
used this rarely. `ProcessesTable.jsx`'s `ProcessRow` gained a delete
(trash icon) button, unconditional, no confirmation dialog - matches
`NamedListManager.jsx`'s own existing delete-without-confirm
convention, not a new pattern.

## 53. Devices list redesign - Speaker category, icon/value columns, active-color, overdue highlight

2026-08-14 - a batch of Devices page changes, all confirmed live
against nexus-edge-aquarium's real control-node instance.

**Library: Speaker category.** `devices/standalone/speaker/`
(new `category.json`) now holds `active-buzzer` (moved, `git mv`) and a
new `passive-buzzer` type - identical single-`Bool` EdgeX contract to
active-buzzer on purpose (see `passive-buzzer/contract.schema.ts`'s own
header), the split is a firmware/hardware distinction only: a passive
buzzer has no built-in oscillator, so producing any sound at all needs
the driving MCU to generate the waveform itself (PWM/`tone()`).
control-node's own real buzzer (`control-node-buzzer`,
nexus-edge-aquarium) was reassigned from `active-buzzer` to
`passive-buzzer` (migration + a live `UPDATE devices SET type = ...`
for the already-seeded row, same two-step gotcha as section 50/51) once
this was noticed - `firmware/src/buzzer.cpp` genuinely drives it via
`tone()`/`noTone()`, confirmed when section 51's crackle bug was fixed.
The underlying EdgeX profile/canId (`NexusEdge-ActiveBuzzer`, `0x304`)
was deliberately left unchanged - this is a NexusEdge-side taxonomy
correction, not a CAN contract change. `apps/ui/src/builtinDeviceTypes.js`
registers its own `ui/control`/`ui/simulator` pair (visually identical
lamp to active-buzzer's own, on purpose).

**Devices list: icon + value columns, Name is plain text now.**
`GET /devices` (`routes/devices.ts`'s `SELECT_DEVICE_LIST_BASE`) gained
a `LEFT JOIN library_items li ON li.type_name = d.type AND li.kind =
'device'`, exposing `icon_path` per row - the same `type_name` key
`usedInProject` already matched against, so the list's own icon column
tracks whatever the Library currently has for that type, no separate
fetch. Value cell: number as-is, a green/red circle+check/x for `Bool`,
a `JSON` badge for anything compound (Device is meant to be atomic -
section 30 - this is a display-safety fallback, not an expected case).
The old `/devices/:id` route/page (`DeviceDetail.jsx`) was removed
outright - "У нас є розгортка" (the expand row already covers it); Name
is plain text in the collapsed row now, not a link to anywhere.

**Icon-on-colored-circle when active.** `device.capabilities.color`
(LED's own pre-existing per-instance hint, `AGENTS.md` sections
7/9 - "which color to show when active") is now read generically for
*any* boolean device's icon, not just `led` - `DeviceIcon` in
`DevicesList.jsx` puts the Library icon on a filled circle of that
color exactly when `value === true`, otherwise plain/transparent. Newly
editable through `DeviceSettingsModal.jsx` (a color-input field) via a
new generic `PATCH /devices/:id/capabilities` (partial jsonb merge,
`requireAuth`, same pattern as `processes/:id/config`) - previously
`color` could only be set at seed time. Same modal also gained a
`physicalId` field, rendered disabled/placeholder-only - reserved for a
future real hardware-address concept, nothing reads or writes it yet.

**Overdue/staleness row highlight (danger).** Confirmed with the user:
reuse the *existing* `data_logger_control` config
(`periodSeconds`/`error.numberSkippedPeriods`) the Data Logger process
already tracks per device (section 21-adjacent), rather than inventing
a separate threshold - a device is flagged `danger` when
`now - lastReadingAt > periodSeconds * error.numberSkippedPeriods *
1000` and that config is actually set. `lastReadingAt` prefers a live
WebSocket event's own timestamp (if one has arrived this session) over
`GET /devices/:id`'s new `readingOrigin` field (EdgeX's own reading
timestamp - **nanoseconds** since epoch, confirmed live against a real
reading, converted to ms server-side before it reaches the client) -
the fetch-once value covers a page that just loaded and hasn't seen a
live event yet, which a live-only signal can't. `danger` (overdue) wins
over the pre-existing `warning` (simulated) row tint - same "highest
severity, never both at once" precedence `ProcessesTable.jsx` already
uses. New `apps/ui/src/hooks/useNow.js` - a periodically-refreshed
current-time hook, since calling `Date.now()` directly during render is
lint-flagged (`react-hooks/purity`); starts at `0` rather than
`Date.now()` even in its lazy initializer, since that still runs during
render too.

**Not done, explicitly deferred**: point 5 of the original request
("В розгортці показуємо") turned out to be an unfinished sentence,
confirmed with the user - nothing changed in the expanded detail row's
own content beyond wiring it to the same single fetch+live `value` the
collapsed row now also uses (previously it fetched independently).

## 54. Speaker category promoted to root, Devices expand row redesigned as two key/value tables

2026-08-15, two quick follow-ups on section 53.

**Speaker is a top-level standalone category now**, not nested under
Indicator - `devices/standalone/speaker/` (sibling to `actuator/`,
`indicator/`, `input/`, `sensor/`), `git mv`'d from
`devices/standalone/indicator/speaker/`. Every reference to the old
path (imports in `apps/ui/src/builtinDeviceTypes.js`, comments in
`AGENTS.md`, the active-buzzer seed migration, device-service's own
profile/device-list YAML) was updated to match - no functional change
beyond the one real import path, everything else was descriptive.

**Devices list expand row - two borderless key/value tables**,
replacing the old LED/buzzer-specific big indicator entirely (the
collapsed row's own icon+value cell already covers that at-a-glance
role since section 53, making the indicator redundant). Left table
("Value") is the live reading side - `value`/`valueType`/`units`/
`dualState.mode`/`valueAuto`/`valueManual`/`readingOrigin` (formatted
via `toLocaleString()`), all from the same single `GET /devices/:id`
fetch `DeviceRow` already owns. Right table ("Device") is the
permanent/registry side - id/type/node/backend/EdgeX name+status/
simulated(+twin)/capabilities/data_logger_control/heartbeat_control/
created/updated. A field whose own value is compound (`capabilities`,
`data_logger_control`, `heartbeat_control`) renders as inline
monospace JSON rather than being recursively flattened - the simplest
option that stays readable, matching the user's own "якщо глибше -
можливо json" suggestion; rows whose value is `undefined` are dropped
entirely rather than showing an empty dash (a read-only sensor simply
has no `dualState`, for instance).

Real layout bug found live: a plain flex row (`d-flex flex-wrap`)
around two `<div>`s each wrapping a Bootstrap `CTable` stacked them
vertically instead of side by side, regardless of `flex-wrap` - a
`CTable` defaults to `width: 100%`, which stretches its wrapping flex
item to fill the entire flex container on its own (no room left for a
second item on the same line). Fixed by giving each `KeyValueTable`
wrapper an explicit `flex: '0 1 420px'` and adding `w-auto` to the
table itself, overriding the 100% default.

Also: the user removed the `hover` prop from `DevicesList.jsx`'s and
`NodesList.jsx`'s own main `CTable`s locally before this session
picked back up - kept as-is, not reverted (their own explicit
"add to the next commit").

## 55. "Last reading"/"Expires" as relative time, not absolute timestamps

2026-08-15 - two small follow-ups on section 54's Value/Device tables.

**`KeyValueTable` no longer renders its own `title`** - the user
removed that line locally ("Я прибрав title, саму проперю давай поки
залишимо") - the `title` prop itself is still passed in from
`DeviceDetailRow`'s two call sites, just unused for now, in case a
later change wants it back without re-threading the prop.

**"Last reading" is relative time now** ("5 minutes ago"/"just now"),
not `toLocaleString()` - reusing `formatRelativeTime`
(`apps/ui/src/utils/format.js`, already used by `NodesList.jsx`'s own
last-heartbeat column) rather than inventing a second helper. It's
typed for an ISO string but really just does `new Date(x)` internally,
so `readingOrigin`'s epoch-ms number works identically without
conversion.

**New "Expires" row** - the user noticed the overdue/staleness
threshold (section 53's `maxAgeMs`/`isOverdue`, `data_logger_control`-
based) was only ever visible indirectly, as the row turning
danger-red, never as an actual value. `DeviceRow` now also computes
`expiresAt = lastReadingAt + maxAgeMs` and passes it down to
`DeviceDetailRow`, rendered via the same `formatRelativeTime`.

This needed `formatRelativeTime` itself to grow future-timestamp
support - the old version computed `diffMs = Date.now() - target`,
which is negative for anything in the future, and its own "count >= 1"
loop never fires on a negative count, so every future timestamp
regardless of distance silently fell through to "just now". Fixed by
taking `Math.abs(diffMs)` and tracking the sign separately, rendering
`"in X <unit>(s)"` for a future target - past-timestamp callers
(`NodesList.jsx`'s own usage included) are unaffected, since the
`future` branch only ever fires when `diffMs < 0`.

## 56. Background-color rule + unified status label across Devices/Nodes/Processes, cross-tab simulation fix

2026-08-15.

**The rule, applied consistently**: error -> `danger`, warning ->
`warning`, simulation -> `info`. Previously each table had its own ad
hoc row-tint logic (Devices/Nodes both used `warning` for simulated,
colliding with the concept "warning" ought to actually mean).

**New shared `RowStatusBadge`**
(`apps/ui/src/components/table/RowStatusBadge.jsx`) - takes the exact
same `rowColor` value each table already computes for its own
`<CTableRow color=...>`, not a second parallel condition, so the label
text and the row's own background can never drift out of sync by
construction. `danger` -> "Error", `warning` -> "Warning", `info` ->
"Simulation", anything else -> "OK"/success. One deliberate
divergence, confirmed with the user: the "Simulation" label itself
reads `primary`, not `info` - the row background and the badge accent
are allowed to differ even though they share the same underlying
`rowColor` value.

**All three tables gained a new leading "Status" column** (this
badge), with their next-most-important existing column moved to
position 2 right after it - Devices: **Backend**, then the
icon/value/name/type/node columns following in their previous order.
Nodes: **Health**. Processes: the ON/OFF/Running badge, renamed
**Power** in its own header to avoid colliding with the new "Status"
column's own name (matches this file's own pre-existing `power`
terminology, see the Switch's `ariaLabel`).

**Devices' old standalone EdgeX-operatingState "Status" column is
gone** - its only content (UP/DOWN/not provisioned) is still reachable
in the expand row's own "Device" table (`EdgeX status`, section 54),
just no longer duplicated as its own top-level column now that the new
label already gives an at-a-glance read. `isError` for a device is
exactly the pre-existing `isOverdue` (section 53) - no new condition
invented.

**`isError` for a node** is `health` present and neither `'ok'` nor
`'unknown'` - `'unknown'` deliberately does NOT count as an error
(means "not determined yet", not "confirmed bad") so a freshly-
registered node doesn't render red before anything has actually gone
wrong.

**Real bug found and fixed, reported live by the user**: the Devices
page never reflected a node's `simulated` flag being toggled from a
*different* browser tab - no code path re-fetched anything unless the
toggle happened on that same page. Investigated whether a live
WebSocket event already existed for this (it does not - the live
protocol only has `device`/`tick`/`process` domains, confirmed by
reading every publisher; adding a proper `node`-domain event would
need a new RabbitMQ-routed publish in `nodes.ts`'s own PATCH route,
following `dualDevicesModel.ts`'s `publishDeviceEvent` precedent).
Given the fix needed *some* form of cross-tab convergence and a full
live-event addition is real, separate scope, went with the same
polling precedent `ProcessesList.jsx` already established for its own
registered-kinds check (`DEVICES_POLL_MS = 10000`, plain
`setInterval(reloadDevices, ...)` in `DevicesList.jsx`) - confirmed
live: toggled simulation in one tab, watched the other tab's row
colors/labels update on their own within the poll interval, no manual
reload. A real live event remains the more correct long-term fix if
this class of gap shows up again for something latency-sensitive -
not built now, this specific case tolerates a ~10s convergence window
fine.

## 57. Nodes Health column removed (dead, stuck at "unknown"); follow-up: `heartbeatStopped` itself turned out wrong too

2026-08-15. The user reported their physically-connected,
actively-heartbeating control-node still showing `Health: unknown` in
the Nodes table. Root cause - `nodes.health` (migration
`1690000000000_create-nodes-table.ts`, `default: "unknown"`) is a
column that is READ everywhere but **never written anywhere** - no
route, process, or orchestrator logic updates it, ever, for any node,
confirmed by grepping the whole backend for any assignment to it. It's
permanently stuck at its schema default regardless of real
connectivity. This also meant section 56's own Nodes `isError` (based
on `health !== 'ok' && health !== 'unknown'`) was **unreachable dead
code** from the moment it shipped - `health` can structurally never be
anything but `'unknown'` today.

Rather than wiring `health` itself up to something real, the user
asked the sharper question first: given the new unified "Status"
column already exists, does a separate "Health" column - one that has
only ever shown `"unknown"` for every node, ever - carry any
information at all? No. Removed the standalone Health column entirely
(`healthColor`/its `<CBadge>` cell/header gone), same "fold into
Status, don't duplicate" reasoning as Devices' own EdgeX-status column
removal. `isError` now reads `node.heartbeatStopped` directly - the
real, already-computed Heartbeating Control signal every `GET /nodes`
row already carries (`heartbeatControl.ts`'s `getNodeHeartbeatStopped`)
- instead of the inert `health` field. The raw (still-unused)
`health` value remains visible in `NodeDetailRow`'s own JSON dump for
anyone who wants to see it - nothing is actually hidden, just not
promoted to its own top-level column anymore. `colSpan` dropped from 8
to 7 to match.

## 58. `node.heartbeatStopped` was ALSO the wrong field - real `heartbeatStale` computation added, Nodes now polls

2026-08-15, same day, one more round. The user physically unplugged
the CAN bus from the control-node to test §57's fix and reported: the
Heartbeating Control process's own row/log reacted correctly (turned
red, logged "hasn't sent a heartbeat in N ticks"), but the Nodes table
- now driven by `node.heartbeatStopped` per §57 - still showed "OK".

Root cause, found by tracing what `heartbeatStopped` actually is
(`apps/api/src/heartbeatControl.ts`'s own doc comment, re-read
carefully this time): it's `isMonitoringStopped`, the Redis-backed
**manual "Stop monitoring" toggle** from the Heartbeating Control
panel (`PATCH /heartbeat-controls/:type/:id/stopped`) - a human
on/off switch, never written by anything staleness-related. §57's own
fix swapped one wrong field (`health`, always `"unknown"`) for another
wrong field (`heartbeatStopped`, always `false` unless a human paused
it) - neither was ever the actual "has this node's heartbeat gone
stale" result. That real computation happens in
`apps/orchestrator/src/processes/heartbeatControl.ts`'s `evaluate()`
every tick, comparing `heartbeatLastSeenAt` against the node's own
`heartbeat_control.warning`/`error` skipped-tick thresholds - but it
only ever writes the result onto the Heartbeating Control **process's**
own row (WEM + `critical`/`warning` via `apiClient.setCritical`/
`setWarning`), never back onto the node itself. Nothing else in the
codebase ever computed this per-node and exposed it.

**Fix**: added `nodeHeartbeatStaleness(config, simulated, stopped,
lastSeenAt)` to `apps/api/src/heartbeatControl.ts` - a pure, sync
request-time replica of the orchestrator's own `evaluate()` logic for
a single node (same skip rules: `simulated` skips entirely, a
`stoppable && stopped` node skips, no `warning`/`error` configured
skips, no `lastSeenAt` yet skips; error takes precedence over
warning). Takes the same `heartbeatStopped`/`heartbeatLastSeenAt`
values `withLiveHeartbeat` (`routes/nodes.ts`) already fetches from
Redis per request - no extra Redis round-trip, no caching layer of its
own, so it's exactly as fresh as `heartbeatStopped` always was, just
computing the right thing. `GET /nodes` now returns a third field,
`heartbeatStale: "ok" | "warning" | "error"`, alongside the
still-present `heartbeatStopped` (kept - it's real info, "is
monitoring paused", just not what a row's error state should be keyed
on).

`NodesList.jsx`'s `isError` is now `node.heartbeatStale === 'error'`.
Deliberately not also coloring the row `warning` for the `"warning"`
tier (unlike Processes, which does use its own warning color) - kept
to the simpler two-state Devices/Nodes precedent (danger/info/ok, no
warning) already established in section 56, matching what
`DevicesList.jsx`'s own `isOverdue` does today. The `heartbeatStale`
field itself does carry the warning tier if a future pass wants to
surface it.

**Second bug in the same table, found while reading `NodesList.jsx`
end to end for this fix**: it had no polling interval at all - only a
mount-time fetch, unlike `DevicesList.jsx` (`DEVICES_POLL_MS`) and
`ProcessesList.jsx`. Even with the field fixed, the table would only
ever reflect a live disconnect on next navigation/reload. Added
`NODES_POLL_MS = 10000` with the same plain `setInterval(reloadNodes,
...)` idiom as `DevicesList.jsx`.

Verified live in nexus-edge-aquarium with the node still physically
unplugged: `GET /nodes` returned `heartbeatStale: "error"` for "Main
node control" (`heartbeatLastSeenAt` ~20 minutes stale), and the Nodes
page rendered it with a red "Error" badge and `danger` row, "Last
heartbeat: 20 minutes ago" - no manual reload needed once the poll
fires. `apps/device-service`'s own CAN transport still has the
non-expiring last-frame cache described in the diagnosis for this same
investigation (Devices' `isOverdue` still gets fooled into looking
"fresh" on every on-demand EdgeX read) - out of scope for this pass,
deferred as a separate, larger fix (Go changes in
`apps/device-service/internal/transport/can/bus.go`, needs a
configurable max-frame-age, would touch every CAN device's read path).

## 59. CAN transport reports a frame's true receipt time, not read time - fixes Devices' staleness check at the root

2026-08-15, picking up §58's deferred item. The actual fix turned out
smaller than anticipated there: no new config value (no "max frame
age" threshold) was needed at all.

**Root cause, precisely**: `busConn.Latest()` (`bus.go`) has always
correctly never expired its per-arbitration-ID cache - a physical node
may legitimately go long stretches between broadcasting a given
signal, so that part was never wrong. The actual bug was one layer up,
in `transport.go`'s `Read()`: it built every `CommandValue` with
`sdkModels.NewCommandValue(...)`, which the EdgeX SDK stamps with
`Origin: time.Now()` - i.e. "when this value was read", not "when
this value was last true". A cached-but-ancient frame therefore always
produced a brand-new, current-looking `Reading.origin` on every
on-demand read, which `devices.ts` already faithfully carries through
as `readingOrigin` (section 53) - and `DevicesList.jsx`'s own
`isOverdue` (section 53/56) is a correct, honest diff against that
timestamp. The staleness *check* was never broken; the timestamp *fed*
into it was a lie.

**Fix**: `bus.go`'s cache now stores `cachedFrame{frame, receivedAt}`
per arbitration ID (`receivedAt` set once, in `readLoop`, when the
frame actually arrives). `Latest()`'s signature grew a third return
value, `time.Time`. `transport.go`'s `Read()` now calls
`sdkModels.NewCommandValueWithOrigin(name, type, value,
receivedAt.UnixNano())` - the SDK constructor that lets a driver
report a reading's *true* origin instead of defaulting to now (found
by fetching the SDK's own `pkg/models/commandvalue.go` source for
`v4.0.2`, the version pinned in `go.mod`). `Write()`'s own unrelated
`Latest()` call (merging existing byte layout before sending a frame)
just ignores the new time value - staleness is meaningless there.

Net effect: once a physical node goes silent, every read of one of its
devices now reports the age it actually has - no code changes needed
in `apps/api` or `apps/ui` at all, since `isOverdue` was already
correct and just needed an honest input. Verified: `go build` (via
the actual Dockerfile build stage - no local Go toolchain available on
this host) and a manual `gofmt -l`/`go vet` pass both clean;
`nexus-edge-aquarium-device-service` rebuilt and restarted.

**Known gap, found while trying to verify this live against the still-
unplugged control-node**: restarting `device-service` empties
`bus.go`'s in-memory cache (it was never meant to survive a restart),
so the two real physical resources on that node
(`control-node-heartbeat`, `control-node-pulse`) came back with no
cached frame at all (`ok=false`, the pre-existing "no data received
yet" error path - unrelated to and unaffected by this fix) rather than
demonstrably showing an old, honestly-aged timestamp. Confirming the
full effect end-to-end needs the node reconnected briefly (to seed one
cached frame) and then disconnected again, without an intervening
device-service restart - not done this session.

**Separate, pre-existing gap noticed along the way, not fixed here**:
neither of those two devices (nor most of this node's other devices,
which are `backend: "virtual"` anyway, e.g. Temperature/Humidity/LEDs
- this control-node only has two real physically-wired CAN resources,
consistent with the "partial physical network" design, AGENTS_TO_DO.md
2026-08-09/10) has `data_logger_control.periodSeconds` set - it's
`null` on every one of them. `DevicesList.jsx`'s `maxAgeMs` requires
`periodSeconds` to be non-null (section 53), so `isOverdue` stays
structurally `false` for these devices regardless of how honest
`readingOrigin` now is. This fix makes the *input* correct; actually
seeing a device row turn red still needs `periodSeconds` configured
per-device (via the existing Data Logger settings, already wired up -
no code gap), which nobody has done yet for this node's own devices.

## 60. Devices list: per-row value/timestamp is now polled, not fetched once - a live-verified §59 follow-up

2026-08-15, same day, closing the loop on §59's own live-verification
gap. `periodSeconds` was set live for `control-node-heartbeat`/
`control-node-pulse` (AGENTS_TO_DO.md) so the user could actually watch
§59's fix react to a real disconnect/reconnect. Two more real bugs
turned up in the process, both found by the user testing live and both
fixed the same session:

**Bug 1 - a row that went Error never came back to OK.** Each
`DeviceRow` (`DevicesList.jsx`) fetches its own value/`readingOrigin`
via `api.getDevice(device.id)` in a `useEffect` keyed only on
`[device.id]` - mount-once, never on an interval, unlike the list-level
`DEVICES_POLL_MS` poll (section 56) which only refreshes the *list*
(name/type/node/etc), not each row's own value. This was harmless
before section 59 - `readingOrigin` was always "now" anyway regardless
of true freshness, so a row's own staleness could never meaningfully
persist either way. Once section 59 made `readingOrigin` honest, the
gap became real: a row that happened to cross its overdue threshold
after mount would stay red forever, since nothing ever fetched a newer
value/timestamp for it again - confirmed live: the user reconnected a
node after its device row had gone red, and it stayed red. Fixed by
giving each row's own fetch the same `DEVICES_POLL_MS` interval as the
list poll, re-fetching (not just fetching once) `api.getDevice`.

**Bug 2 - the same row then flickered Error/OK/Error/OK while
connected, rather than settling.** Root cause was the periodSeconds
value chosen when configuring these two devices live, not a code bug:
`periodSeconds=1, error.numberSkippedPeriods=2` (a 2s staleness
window) is tighter than `DEVICES_POLL_MS` itself (10s) - between polls,
`lastReadingAt` sits fixed while the ticking clock (`useNow`) keeps
advancing, so the row necessarily reads "overdue" for most of each 10s
window and only briefly recovers right after each poll lands. Not
something bug-1's fix could address - it's a threshold-vs-poll-cadence
mismatch, and would reproduce for any device configured with a
staleness window shorter than roughly 2x the poll interval. Fixed by
raising `error.numberSkippedPeriods` to 20 (a 20s window, comfortable
margin over the 10s poll) for both devices, live via the same
`PATCH /data-logger-controls/:deviceId` used originally - a config
correction, not a code change. General guidance for configuring any
device's Data Logger thresholds going forward: keep the effective
window (`periodSeconds x numberSkippedPeriods`) meaningfully larger
than `DEVICES_POLL_MS`, or the UI will flicker regardless of real
hardware health.

Verified live in nexus-edge-aquarium: `control-node-heartbeat` stayed
stably OK for 10+ seconds after the threshold fix, actively-incrementing
value visible the whole time.

`control-node-pulse` remains open, separately - it is fundamentally
write-only (NexusEdge writes it to the node every tick, "proves
NexusEdge is alive," not the reverse) and is never actually receivable
back off the bus (no `CAN_RAW_RECV_OWN_MSGS` on our own socket, and the
node's firmware doesn't echo it) - `bus.Latest()` for its arbitration
ID (`0x300`) is permanently empty, confirmed via continuous
`"no data received yet"` in `device-service`'s own logs regardless of
connection state. Its "OK"/checkmark in the UI reflects the Dual
Devices Model's own live-published *auto value* (`dualDevicesModel.ts`'s
`publishState`, whose own doc comment already says "not a
heartbeat/liveness signal") - i.e. what NexusEdge is commanding, not a
confirmed physical read - refreshed every tick unconditionally,
regardless of bus state, so it can never structurally show stale. Not
a bug in today's fixes; a pre-existing, one-directional design
property of this specific resource. Proposed fix (a `writeOnly`
capability flag, mirroring the existing `readOnly` one, so `GET
/devices/:id` stops attempting - and logging - a read that can never
succeed, and the UI renders it distinctly rather than implying a
confirmed reading) - not yet actioned, awaiting the user's choice of
display treatment.

## 61. New `node` live WS domain - Nodes list is push-driven, not polled

2026-08-16. The user's own question, after living through §58/§60's
poll-cadence-vs-threshold class of bugs: "we already have an open
socket to the server - why not push a message when a node's state
changes, instead of re-polling?" Agreed, with one scoping note given
back before starting: a discrete write (simulated/group/name) maps
cleanly onto a push event, but a *passive* staleness transition (a
node going silent - nothing "happens" at the exact moment a threshold
is crossed) doesn't, unless something proactively evaluates and diffs
it. The orchestrator's own heartbeat-control process kind already does
exactly that every tick (section 28), so it was the natural place to
diff and notify from. Devices' own `isOverdue` stays poll-based for
now - it's computed client-side from `data_logger_control`, not
server-side like `heartbeatStale` (section 58), so doing this properly
there first needs moving that computation server-side - a separate,
larger piece of work, deliberately out of scope here.

**Wire protocol** (`apps/api/src/messaging.ts`): a third domain
alongside `device`/`process` (section 9), same RabbitMQ topic exchange
(`nexus.events`), routing key `node.<id>.updated`. This retires the
`node.<id>.heartbeat` shape section 9 reserved - a node was never
atomic-one-value the way a Device is, so there's no single "heartbeat"
event worth splitting out; one `updated` type carrying the whole
live-ish row (not a hand-picked field subset, same philosophy as
`device`'s own envelope) covers both a discrete write and a staleness-
tier change. `apps/messaging-gateway` needed **zero** changes - it
already relays every `nexus.events` message generically by routing-key
pattern match, domain-agnostic by design (confirmed: no shared domain
enum exists anywhere in this codebase, `domain` is just a string
literal duplicated per file, same as `device`/`process` already are).
No new snapshot cache either (unlike `device`'s `state:*`) - NodesList.
jsx always does its own initial `GET /nodes` REST fetch on mount, so
the socket is only ever needed for *subsequent* live updates.

**Publish side** (`apps/api/src/routes/nodes.ts`): a `publishNodeState`
helper (whole `withLiveHeartbeat` row as `value`) called from all three
mutating routes (`PATCH /:id/group`, `/:id/simulated`, `/:id/name`) -
each already had the fresh row in hand for its own HTTP response, so
this is just one extra call, not a new query. New `POST /nodes/state/
broadcast` (body: `{nodeIds, reason?}`) mirrors `POST /processes/
state/broadcast`'s own "forced" shape, scoped to specific ids rather
than the whole fleet - this is what the orchestrator calls for the
passive case below.

**The passive-transition half** (`apps/orchestrator/src/processes/
heartbeatControl.ts`): a new module-level `Map<number, StalenessLevel>`
(`lastNodeStaleness`, in-memory only, resets cleanly on restart - same
defensive stance as `controlNode.ts`'s own `lastHeartbeat` map) tracks
each node's `heartbeatStale` (now also added to `apiClient.ts`'s
`NodeRecord` type, reusing the value `GET /nodes` already computes -
not a third re-derivation of the same threshold math) from the
previous tick. `notifyStalenessChanges()` runs every tick right after
`evaluate()`, diffs, and calls `apiClient.broadcastNodeState()` only
for ids that actually changed (an empty list skips the HTTP call
entirely - most ticks, nothing changed).

**Frontend** (`apps/ui/src/api/useLiveNode.js`, new): `useNodesLiveState()`
- a fleet-wide `{[id]: value}` overlay map, mirroring `useDeviceLiveState`'s
internals but shaped for `NodesList.jsx`'s flat-array rendering (no
per-row component to subscribe individually the way `DevicesList.jsx`'s
`DeviceRow` does). `NodesList.jsx` spreads `liveNodes[node.id]` over
each row before filtering/pagination; the old `NODES_POLL_MS` interval
is gone entirely. One addition beyond pure push: a reconnect-triggered
one-shot `reloadNodes()` (via `useLiveConnectionStatus()`, skipping the
initial `false -> true` on mount) - a dropped WebSocket connection by
definition can't have delivered whatever happened while it was down,
and nothing else would ever correct that without a manual page reload.

**Verified live**, both directions, in nexus-edge-aquarium with two
browser tabs open on Nodes:
- Discrete write: toggled `simulated` in tab A, tab B's row (Status
  badge + Switch) updated instantly with no reload - tab B never wrote
  anything itself, so this could only have come from the live push.
- Passive transition: rather than needing the physical node
  disconnected again, forced it via `PATCH /heartbeat-controls/node/2`
  (`error.numberSkippedTicks: 0`, tripping "error" on literally the
  next tick regardless of real connectivity) - the open tab flipped to
  red "Error" within ~1s with zero interaction on that tab at all.
  Restored the threshold afterward and watched it flip back to green
  "OK" live the same way - confirms the orchestrator's tick-diff
  correctly detects a transition in *either* direction, not just
  worsening.

## 62. Devices' `isOverdue` moved server-side, same push mechanism as §61 - with a genuinely harder passive case

2026-08-16, same day. §61's own closing line ("Devices' own `isOverdue`
stays poll-based - it's computed client-side... doing this properly
there first needs moving that computation server-side") became today's
task. The parallel to Nodes held for the *discrete* case but broke
down for the *passive* one, in a way worth recording precisely, since
it changed the shape of the fix partway through.

**Server-side computation**: `dataLoggerControl.ts` gained
`computeOverdue(config, readingOriginMs, nowMs)` - a pure function,
identical math to what `DevicesList.jsx` used to run client-side
(`periodSeconds x error.numberSkippedPeriods` vs. `now - readingOrigin`),
just the one place both `GET /devices/:id` and `POST /devices/:id/log`
now call it from. `DeviceEventEnvelope` (`messaging.ts`) grew optional
`isOverdue`/`expiresAt` fields, riding the *existing* `device` domain -
no new domain needed here, unlike `node`.

**Where it diverges from Nodes - the passive case has no existing
evaluator to piggyback on.** Nodes already had Heartbeating Control
running every tick across every node, for free. Devices have nothing
equivalent for "is this sensor's last reading still fresh" - the only
things that ever read a device's live value are an on-demand `GET
/devices/:id` (a UI page view) and Data Logger's own periodic
write-cadence read (`writeEnabled` devices only). Once
`DevicesList.jsx`'s per-row poll (section 60) was removed on the
assumption "isOverdue is server-computed and live-pushed now, no poll
needed" - true only if *something* keeps re-evaluating it - a real gap
appeared: `control-node-heartbeat` (this session's own real physical
test device, `writeEnabled: false` by design - periodSeconds is set
purely for live staleness detection, not history logging) had nothing
left to re-read it at all. Found by re-deriving the theory before
touching code, not live this time - but it would have reproduced the
exact "frozen forever" class of bug section 60 fixed, just in the
opposite place.

**Fix: `dataLogger.ts`'s loop no longer skips `!writeEnabled` devices
entirely.** `listDataLoggerControls()`'s own query was never
`writeEnabled`-scoped to begin with (only `readOnly`) - the gate was
purely in the orchestrator's own loop. Split the loop: `writeEnabled`
devices keep their exact existing behavior (`maybeLog`, then WEM if
configured); `!writeEnabled` devices instead get a new `maybeTouch` -
same due/cadence bookkeeping as `maybeLog` (in-memory `Map`, resets on
restart), but calls `apiClient.getDevice(id)` (already existed) purely
to trigger `GET /devices/:id`'s own read-and-publish, no history write,
no WEM (that alert is specifically "logging is overdue," meaningless
for a device that was deliberately configured not to log). One
additional wrinkle caught before it shipped: the existing
`periodSeconds <= TICK_SECONDS && !tickLoggingEnabled` guard (built to
stop *write* spam at tick resolution) was also silently blocking
`maybeTouch` - a read, not a write, so that guard doesn't apply to it
at all; moved it to only gate the `writeEnabled` branch.

**Second thing caught before shipping, not live this time either: the
publish was originally gated on "did `isOverdue` itself change"** (a
Redis-cached last-known value, diffed each call) - deliberately mirroring
section 61's own diff-before-publish precedent to avoid "needless"
traffic. This quietly broke live *value* updates for the overwhelmingly
common healthy case: a device whose `isOverdue` never changes at all
would never publish anything after its own initial mount fetch, even
though the value was being read fresh every `periodSeconds` via
`maybeTouch`/`maybeLog` the whole time. Removed the diff/cache
entirely (`getLastKnownOverdue`/`setLastKnownOverdue`, both now
deleted) - `publishDeviceReading` (renamed from `publishOverdueIfChanged`
to reflect this) now publishes unconditionally on every call. Not
excessive: every caller (a page's own one-time mount fetch, Data
Logger's `periodSeconds`-paced touch/write) is already naturally
rate-limited to roughly that cadence - nothing calls this every tick.

**`DevicesList.jsx`**: dropped the client-side `dlc`/`maxAgeMs`
computation entirely; `isOverdue`/`expiresAt` now come from
`live.isOverdue ?? fetched?.isOverdue ?? false` (same live-over-fetched
precedence `value`/`lastReadingAt` already used). `useNow()` is kept,
now purely to force a re-render each second so the "Last reading"/
"Expires" relative-time text keeps visually ticking - it no longer
feeds the overdue computation itself. The per-row poll from section 60
is gone (superseded, not merely redundant, by this).

**Verified live**, node genuinely disconnected/reconnected (not a
synthetic threshold trick this time, precisely because the touch
cadence and the threshold interact - see below):
- `control-node-heartbeat`'s displayed value kept advancing
  (18438 -> 18451) purely from live pushes, no poll, no reload -
  confirms the diff-removal fix.
- Node physically disconnected: row flipped to red "Error" live,
  value frozen at its last real reading (18481) - confirms a genuinely
  silent device is detected, not just a config trick.
- Node reconnected: row flipped back to green "OK" live, value resumed
  advancing (18539) - confirms recovery, both directions, matching
  section 61's own Nodes verification.

**A test-methodology note worth keeping**: an early attempt to force a
transition via `error.numberSkippedPeriods: 0` silently no-opped -
`0` is falsy in JS, and `computeOverdue`'s own truthy-chain (faithfully
copied from the original client code) treats a falsy
`numberSkippedPeriods` as "not configured," same as `null`. Pre-existing,
not introduced today, and not worth a special case for a threshold that
never makes practical sense at exactly zero - just something to
remember when hand-testing this specific config shape again. A second
attempt (`numberSkippedPeriods: 1`, `periodSeconds: 1`) revealed a
different, more interesting effect: when the threshold window and the
touch cadence are the *same* size, the touch keeps arriving just
before the deadline, so it never trips at all under real operation -
which is actually correct/desirable, not a bug (a device being read
right on schedule shouldn't ever appear overdue) - but means forcing a
clean demonstration needs either a threshold with real margin over the
touch cadence (as section 59's own "keep the window notably larger
than the polling/touch interval" lesson already established) or, as
done here, genuine silence.

**Deliberately not done**: `control-node-pulse` (write-only, never
receivable off the bus - section 59/60's own writeup) still has no
`isOverdue` producer and never will via this mechanism - `readingOrigin`
stays permanently `null` for it regardless of how often anything reads
it, so `computeOverdue` correctly and permanently returns `false`. This
was flagged to the user separately as its own open question (server-
side display treatment for a write-only resource), not addressed here.

## 63. Header Simulation badge, Nodes/Devices status filters, Heartbeating Control panel polish

2026-08-16, same day, three independent, smaller requests batched into
one pass.

**Header blinking "Simulation" badge** (`AppHeader.jsx`, left of
`SystemTickIndicator`) - visible whenever `useAnyNodeSimulated()`
(`useLiveNode.js`, new) is true. That hook does its own one-time `GET
/nodes` fetch layered with the existing `useNodesLiveState()` overlay -
since the header mounts app-wide and the underlying WebSocket
connection is shared regardless of which page is open, a `simulated`
toggle on the Nodes page updates this badge immediately even though
the header component has nothing to do with that page. Reuses the
existing `.wem-blink-ring` CSS animation (`NotificationCenter.jsx`'s
own warning/error icons) rather than inventing a second blink
mechanism.

**Nodes/Devices status filter** - a new leftmost filter dropdown (OK/
Error/Simulation), filtering by the exact same `rowColor` value each
table already computes for its own row - factored into a shared
`nodeRowColor(node)`/`deviceRowColor(device)` function in each file so
the filter and the row's own background can never drift apart (same
"derive from one source" principle `RowStatusBadge` itself already
established, section 56).

Devices needed more than Nodes here too, in a smaller echo of section
62's own finding: `NodesList.jsx` already computes every row's status
in one flat array up front, so filtering by it was trivial. `isOverdue`
in `DevicesList.jsx`, by contrast, is only known *inside* each
`DeviceRow` after its own async mount fetch - the parent has no
visibility into it, and pagination/filtering happen at the parent
level, before any row for an unfiltered page has even mounted (a
circular dependency: what's filtered determines what renders, but what
renders is what determines the filter's own input). Fixed by having
`GET /devices` (list route) include a per-device `isOverdue`, sourced
from a new write-only Redis snapshot (`dataLoggerControl.ts`'s
`setOverdueSnapshot`/`getOverdueSnapshots`) that `publishDeviceReading`
(section 62) now also writes on every read, batch-read via one Redis
`MGET` for the whole list rather than N round-trips. This is
necessarily a *snapshot* (refreshes only as often as something reads
that specific device - a mount fetch, Data Logger's own touch), not
live - the filter itself only re-runs when the list-level poll
(`DEVICES_POLL_MS`) refreshes `GET /devices`, same cadence the
cross-tab `simulated`-convergence poll already used. Each `DeviceRow`'s
own rendered color still uses its own live-updated `isOverdue`
(unchanged from section 62) - marginally fresher than the filter's own
input, the two agree within one read/poll interval of each other.

**Heartbeating Control panel** (`HeartbeatControlPanel.jsx`) - three
asks: a status filter (OK vs "Warning or Error", one combined option
per the user's own framing - "quick search for problem entities", not
separate Warning/Error options), a leading icon column, and row
background coloring for a problem entity. All three needed a
*computed* per-row staleness the panel's own `GET /heartbeat-controls`
never returned before today - `heartbeatControl.ts`'s `listEntities`
only ever returned the *config* (thresholds), never whether an entity
is *currently* stale by them.

Generalized `nodeHeartbeatStaleness` (section 58) into a shared
`computeStaleness(config, stopped, lastSeenAt)` - node's own
`simulated` skip is now a thin wrapper around it
(`nodeHeartbeatStaleness` itself unchanged from nodes.ts's point of
view). `listEntities` now also joins `library_items` (by `(kind,
type_name)`, the same key `routes/devices.ts`/`routes/library.ts`'s
own `usedTypeNames()` already join on per entity type -
`processes.kind`, `devices.type`, `nodes.type`) for the icon, and
computes `staleness` per row using whatever `lastSeenAt`/`stopped`/
`simulated` (node only, `false` literal for process/device in the
query) it already had to fetch anyway - no new Redis reads, this was
already request-time/live, same as `GET /nodes`'s own `heartbeatStale`
(section 58). Devices always resolve to `"ok"` here (no real heartbeat
producer, `lastSeenAt` always `null` for that type - unchanged,
long-standing limitation, not addressed today) - correct, not a gap
introduced by this pass.

Frontend: `entityRowColor(entry)` (error -> danger, warning -> warning,
no simulation tier - this panel spans three entity types and only
staleness is a concept shared by all of them) drives both the new
leading icon-column `<CTableRow color=...>` and the status filter,
same "one source" principle as the Nodes/Devices filters above.

**Verified live** in nexus-edge-aquarium: toggled a node's `simulated`
switch in one tab, watched the header badge appear/blink and
disappear live in the same tab with no reload; the Nodes/Devices
status filters correctly isolated the simulated node / correctly
returned "no devices" for a Devices Error filter when nothing was
actually overdue; the Heartbeating Control panel's own "Warning or
Error" filter, after a page reload to force a fresh `GET /heartbeat-
controls`, correctly surfaced "Main node control" - the physical node
had genuinely gone silent for about a minute during this same testing
session (not a synthetic condition) - with its row highlighted red and
its own entity icon showing, consistent with what the Nodes page
itself showed for the same node at the same moment.

**Follow-up, same day**: the user hit exactly the "needs a page reload"
symptom this section's own verification note above had already run
into and shrugged off as coincidental timing - it wasn't. Root cause:
`HeartbeatControlPanel.jsx` fetches `GET /heartbeat-controls` exactly
once, on mount, and never again - no poll, no live subscription, not
even the list-level polls `NodesList.jsx`/`DevicesList.jsx` already
have. An entity going stale *after* that one fetch doesn't just render
unhighlighted - it's genuinely absent from `entries`, so the new status
filter (which runs against that same stale array) correctly reports
"no entities match" even while a real problem exists, and looks broken
until a manual reload forces a fresh fetch. This panel was never given
any refresh mechanism at all when it was first built (section 28) -
today's filter/icon/highlight work just made the pre-existing gap
externally visible for the first time.

Fixed with the same `HEARTBEAT_CONTROLS_POLL_MS = 10000` precedent as
`DevicesList.jsx`/the old `NodesList.jsx` poll - not migrated to a live
push mechanism (this panel spans three entity types across three
different domains, a bigger unification than this fix warranted).
Also added a manual reload button (`cilReload`, the same
`IconButton`/`ariaLabel="Reload"` idiom already used identically in
`CommandLogsTab.jsx`/`ProcessMessageLogsTab.jsx`/`DeviceLogsTab.jsx`),
placed left of Reset Filters per the user's own request - useful
regardless of the poll, for forcing a fresh read on demand.

Verified live: forced node 2's thresholds to an effectively-infinite
value via `PATCH /heartbeat-controls/node/2` (making it resolve to
"ok"), watched the same already-open, already-filtered ("Warning or
Error") tab for 10s with **no reload** - the row disappeared and the
entity count dropped on its own once the poll fired, confirming this
wasn't just "worked because the page happened to be freshly mounted."
Restored the original thresholds afterward; the reload button was
also exercised directly.

## 64. Devices expand row - CSS Grid replaces the fixed-flex-basis layout, compacted

2026-08-16. The user asked to make the expand row's two key/value
tables (`DevicesList.jsx`'s `KeyValueTable`/`DeviceDetailRow`, section
53) more compact and fix a "large right-side margin" on the right
table.

Root cause of the margin: section 53's own layout used
`flex: '0 1 420px'` on each table's wrapper - a fixed flex-basis,
chosen at the time specifically to stop a 100%-wide Bootstrap table
from forcing its sibling onto its own line. That fix worked but
over-corrected two ways at once: it capped BOTH tables at 420px even
when the page had far more room, and it reserved the full 420px even
when a table's own content was much narrower - so the right table's
own wide values (`Capabilities`/`Data Logger`/`Heartbeat Control`
JSON) wrapped awkwardly into a ~270px column while a large blank
margin sat unused past both tables entirely.

Replaced the flexbox layout with CSS Grid:
`gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))'` on the
row's own wrapper, `w-auto` removed from each `CTable` (default
Bootstrap `width: 100%` now applies *within* its own grid column,
which can't force a sibling column to shrink the way a flex sibling
could). Two columns share the row when there's room for two
>=320px tracks, otherwise it falls back to one column per row - same
graceful degradation the old flex-wrap aimed for, without the fixed-
width guess.

Compactness: row padding tightened from `py-1` (0.25rem top/bottom via
Bootstrap's own spacing scale) to an explicit `0.125rem` via inline
style (finer-grained than the closest Bootstrap utility step allows),
`small` className added to the table itself for smaller text (CoreUI's
`<CTable small>` *prop* only reduces padding via Bootstrap 5's own
`.table-sm`, which does not touch font size at all - the separate
`small` *CSS* class, already used identically for `NodeDetailRow`'s
own JSON dump in `NodesList.jsx`, is what actually shrinks the font).

Title style: `title` was a real prop since section 53 but never
actually rendered - an earlier direct edit had removed just the
render while leaving the prop itself in place. Given the two tables
now sit in independent grid columns with no visible separator between
them, added a compact treatment - small, uppercase,
`text-body-secondary`, letter-spaced - specifically to answer "can
change title style" by giving the titles an actual style for the
first time, not simply restoring the old (removed) plain-text one.

Verified live in nexus-edge-aquarium: expanded a device row with rich
JSON fields (Buzzer 1/active-buzzer) - `Capabilities`/`Data Logger`/
`Heartbeat Control` now wrap at their own column's real width instead
of a narrow fixed one, the "VALUE"/"DEVICE" titles render, rows are
visibly tighter, and no blank margin remains past the right table's
own content.

## 65. DevicesList's last poll retired - metadata changes now push over the `device` domain too

2026-08-23. Closes the one deferred item sections 62/63 both explicitly
flagged and left alone: `DevicesList.jsx`'s own `DEVICES_POLL_MS` list-
level `GET /devices` poll (10s), kept specifically because no live event
existed yet for a node's `simulated`/rename reaching Devices, or for a
device's own rename/Device Group/Node reassignment/capabilities edit
made in a different tab. The user noticed the poll was still firing (a
DevTools Network tab observation, not a guess) and asked directly
whether it was still needed, in the same conversation where a physical
CAN reconnect turned out to have exposed just how sluggish Devices'
reaction actually was compared to Nodes.

**Two distinct things were making Devices "slower than Nodes" that day,
worth keeping separate**: (1) `control-node-heartbeat`'s own
`data_logger_control` error window (20s, section 62's own deliberate
choice to stay clear of the touch-cadence race) is genuinely wider than
Nodes' 10-tick/10s threshold - a config difference, not fixed here; (2)
the list-level poll itself, which this section retires.

**`messaging.ts`**: `DeviceEventEnvelope.value` became optional, and a
new optional `metadata` field added - carries the whole `GET /devices`
list-row shape (not a hand-picked subset, same philosophy as
`NodeEventEnvelope.value`), present only for a registry/metadata change,
never together with a real reading. Keeping the two on separate fields
(rather than overloading `value` for both purposes) was deliberate:
`useDeviceLiveState`'s reducer previously overwrote `value`/`mode`/etc.
unconditionally on *every* event for a device, so a metadata-only event
publishing under `value` would have silently clobbered the last known
live reading with `undefined`. Fixed the reducer itself to only touch
the reading fields when `'value' in event`, metadata fields only when
`event.metadata !== undefined` - a metadata event and a reading event
now can't step on each other regardless of which arrives first.

**`routes/devices.ts`**: new `publishDeviceMetadata(deviceId, source)`,
called after each of the five metadata-mutating routes (Device Group
membership, Node assignment, simulated toggle, rename, capabilities) -
mirrors `publishDeviceReading`'s own shape, reusing `findDeviceListRow`
each route already computes for its own HTTP response rather than a
second query.

**Frontend**: new `useDevicesMetadataLiveState()` (`useLiveDevice.js`,
fleet-wide `{[id]: row}`, mirrors `useNodesLiveState`'s own shape - a
per-id selector like `useDeviceLiveState` isn't the right shape for
`DevicesList.jsx`, which renders from one flat array, not a per-row
subscribing component). `DevicesList.jsx` now merges two live sources
into its own `devices` array before filtering/rendering: this metadata
overlay (patches a device's own row on any registry change, anywhere),
and the *existing* `node` domain (`useNodesLiveState`, section 61) for
`node_name`/`node_simulated` - a node's own rename/simulated toggle
reaching every device attached to it, without Devices needing its own
copy of that logic. `DEVICES_POLL_MS`/its `setInterval` are gone
entirely, replaced by the same reconnect-triggered one-shot refetch
pattern `NodesList.jsx` already established (a dropped-then-restored
WebSocket connection can't have delivered anything while down; nothing
else still needs a recurring timer).

**A red herring during verification, not a code bug**: after deploying,
`GET /devices` was still observed firing every ~10s in the API's own
request log. Confirmed via elimination (closed every automation-
controlled tab entirely - the poll kept firing) that this was the
user's *own*, separate browser tab still running the pre-rebuild
cached bundle (confirmed by grepping the freshly-built container's
served JS for `DEVICES_POLL_MS` - genuinely absent). A hard reload
(Ctrl+Shift+R) on that tab was the actual fix, not a code change.

**Verified live** in nexus-edge-aquarium with two fresh tabs (guaranteed
non-cached bundle): renamed a device via a direct authenticated
`fetch()` call (bypassing a UI click that silently failed to submit)
and watched the second tab's row update instantly, no reload; toggled
`Main node control`'s own `simulated` flag the same way and watched
every device attached to it - and the header's own Simulation badge -
flip live across the whole list simultaneously, also with zero polling
in either direction.

## 66. New "weather-node" node type - CORE Library + firmware scaffold, first Device with no EdgeX backend at all

2026-08-23. `Node Weather Control.txt` (AGENTS_TO_DO.md) - components
ordered, not yet in hand; this section is the CORE-side software prep
done ahead of hardware arrival, same "build simulated first, wire to
real CAN later" order `control-node` itself followed.

**Hardware -> Devices mapping, settled up front**: three physical
sensors, four raw logical readings, plus one computed one - AHT20
(temperature + humidity, two atomic Devices, same "one I2C chip, two
Device rows" precedent `control-node`'s own `../humidity` contract
already established), BMP280 (pressure only - its own temperature output
read and discarded, AHT20 already covers that), a photoresistor (raw,
uncalibrated ADC count). A `weather-control` process derives a 6-level
categorical light-level (`very-sunny`/`sunny`/`medium`/`overcast`/
`dusk`/`dark`) from the raw value every tick - **5 Devices total** on a
real instance, not 4: temperature, humidity, pressure, light (raw),
light-level (computed).

**New Library device types** (`devices/standalone/sensor/`):
`pressure` and `light` are ordinary readOnly sensor types, same shape as
`temperature`/`humidity` - nothing new architecturally. `light-level` is
the first Device type in this library with **no
`edgex-device-profile.yaml` at all** - no physical or virtual EdgeX
backend, deliberately. Two existing write paths were checked and both
rejected it: `PUT /devices/:id/auto` requires a resolvable EdgeX device
via `requireEdgeXDevice` and rejects `readOnly` devices outright; `PUT
/devices/:id/simulate` *also* requires a resolvable EdgeX device (it
writes the value out through EdgeX too, not just the `state:*` cache -
see its own `writeOrReject` call). Neither fits a value that was never
meant to have hardware behind it.

**New route, `PUT /devices/:id/reading`** (`routes/devices.ts`) -
skips EdgeX entirely, calls `dualDevicesModel.publishReading()` directly
(the same cache-refresh-and-publish primitive `.../simulate` already
used for its own side effects) after confirming the device exists and is
`readOnly`. Not logged via `logCommand` - a process re-asserting its own
computed reading every tick isn't a "command" worth auditing, any more
than an ordinary EdgeX-sourced sensor reading is. New orchestrator
`apiClient.setDeviceReading(deviceId, value)` calls it - the
`weather-control` process's own future runner (a target project's
`plugins/weather-control/process.ts`, not built yet - see below) will
use this the same way `control-node/process.ts` uses `setDeviceAuto` for
Pulse.

**New node type**, `devices/nodes/weather-node/` - `node.yaml`
(`supports:` temperature/humidity/pressure/light/light-level/heartbeat),
full firmware scaffold (`firmware/src/{config,env_sensor,
pressure_sensor,light_sensor,can_bus,main}.{h,cpp}`, PlatformIO project),
`docs/wiring.md`. Simpler than `control-node`'s own firmware - this
board has no watchdog/LED/buzzer/reset function at all, transmit-only
(no `canBusReceive()`), just three sensors read on their own intervals
plus a heartbeat, once/sec. New CAN ID block `0x310`-`0x31F` (deliberately
leaving `0x306`-`0x30F` free for `control-node`'s own future growth, in
case the two ever do share one physical bus - an open wiring question,
not a firmware one, see `wiring.md`'s own note on dedicated-segment vs.
shared-bus). AHT20 and BMP280 share one I2C1 bus at different fixed
addresses (`0x38`/`0x76`) - no second bus needed. Firmware is untested
(components not yet in hand), written by direct analogy with
`control-node`'s own AHT20 protocol code and STM32_CAN wrapper, same
`HAL_CAN_MODULE_ENABLED` build flag applied proactively (a known,
documented STM32_CAN + STM32duino requirement, not something to
rediscover).

**New UI** (`apps/ui/src/views/processes/`): `WeatherControlPanel.jsx`
(expandable-row detail, `KIND_PANELS['weather-control']`) - read-only
display of all five readings, no thresholds here (this process has none
of its own to edit). `WeatherZonesSection.jsx` - the zone-boundary
editor, registered in `ProcessSettingsModal.jsx`'s
`EXTRA_SETTINGS_SECTIONS['weather-control']` (the user's own "Config
процесу" placement, not the expandable panel) - horizontal diagram of
the 6 zones proportional to a 0-4095 raw range, a dashed marker at the
raw light Device's current live value, one boundary `NumericStepper` per
border between adjacent zones (min/max clamped against neighbor zones),
an "accept current value" button per boundary, and a color picker per
zone. Staged locally via a ref (`extraConfigRef`, generalized from what
used to be `AnnunciatorSlotsSection`'s own hardcoded `slotsRef` - a new
`EXTRA_CONFIG_FIELD` kind->field map lets `ProcessSettingsModal.jsx`'s
`handleSave` stay generic across both of these now, not just one),
committed to `process.config.zones` only when the modal's own Save runs
- Cancel/close discards it, matching the spec's explicit Save/Cancel
ask. Icons: `@coreui/icons` has no dedicated weather set -
`cilSun`/`cilBrightness`/`cilCloudy`/`cilCloud`/`cilContrast`/`cilMoon`
stand in (`lightLevels.js`); `cilBrightness`/`cilContrast` are generic
UI icons, not literal sun/dusk glyphs, worth a visual check once seen
live.

**Not done yet, deliberately** - same split `control-node`/
`ControlNodePanel.jsx` already established: the process *runner*
(`plugins/weather-control/process.ts`) and the real node instance seed
migration both belong in a target project, not core, and need a real
deployment decision (which project, own CAN segment or shared with
`control-node`) this session didn't settle.

**Follow-up, same day** - wired the real instance into
nexus-edge-aquarium (`migrations/002_seed_weather_node.sql`, `plugins/
weather-control/process.ts` mirroring `plugins/control-node/process.ts`'s
shape minus the Pulse/watchdog half this node type has none of,
`extra-res/devices/weather-node-devices.yaml`, `backend: virtual`
throughout - see that project's own AGENTS.md for the instance-level
writeup). 6 devices on the real instance, not 5 - heartbeat is a Device
too, same as `control-node`. Rebuilt and live-verified end to end
(`docker compose build` + `up -d` on api/orchestrator/device-service/ui,
then Dev Simulator -> Processes -> Weather Node's own panel and Settings
popup) - and two real bugs surfaced only by that live pass, both fixed
here in core, not worked around in the target project:

- `apps/device-service/internal/driver/codec.go`'s `coerceToValueType`
  had no `Uint16` case (only Bool/Int32/Uint32/Float32/Float64/String) -
  `light`'s Uint16 valueType fell through to the passthrough default,
  and EdgeX's own `NewCommandValue` rejected the raw YAML-decoded `int`
  it got instead. Added the missing case (`toInt64` too, for the
  write-then-read-back round trip - same reasoning already documented on
  its `int32` case for Int32/Uint32).
- `routes/devices.ts`'s `GET /devices/:id` turned out to have NO code
  path at all for a Device with no resolvable EdgeX name - `value` stayed
  hardcoded `null` forever, regardless of what `PUT /devices/:id/reading`
  had written into the `state:*` cache. This one was invisible from the
  write side alone (the route returned `200 {"status":"ok"}` correctly)
  and only surfaced reading the value back - a reminder that
  `publishReading()`'s own doc comment ("reach the state:* cache and
  nexus.events") was written with the *live push* consumer in mind, not
  the plain REST GET, which turned out to have its own entirely separate
  value-sourcing logic. Added `dualDevicesModel.getReading()` (reads back
  what `publishReading()` last wrote) and a new `else if
  (device.capabilities.readOnly)` branch in the route, parallel to the
  EdgeX branch above it.

Both fixed and live-verified before this follow-up was written: raw
light simulated to 3800 via the Dev Simulator, `weather-control`
classified it to `very-sunny` within one tick with zero manual
intervention, and both the WeatherControlPanel and WeatherZonesSection
(marker position, current-zone label, "Accept current value") rendered
correctly against that live value in the browser.

**Second follow-up, same day** - with no real firmware for 3-5 weeks
(components still in transit), `weather-node-01` had no way to ever send
a real heartbeat, so Heartbeating Control would eventually flag it stale
regardless of everything above working correctly. The platform's
existing fix for exactly this ("simulated" toggle on a Node,
`nodeHeartbeatStaleness`: `if (simulated) return "ok"`) turned out to be
unreachable for it: `PATCH /nodes/:id/simulated`'s own guard (`routes/
nodes.ts`, originally added for `control-node`'s partial-physical-network
feature) unconditionally required at least one device on the node to
have a simulated twin (`edgex_device_name_simulated`) before allowing
`simulated: true` - correct for a node with real hardware to redirect
away from, but weather-node has zero `backend: physical` devices at all
right now, so no twin could ever exist and the toggle was permanently
blocked with a 409.

Fixed by scoping the check to nodes that actually have a physical
device: `SELECT count(*) FILTER (WHERE backend = 'physical'), count(*)
FILTER (WHERE edgex_device_name_simulated IS NOT NULL) FROM devices
WHERE node_id = $1` - reject only when `physical_count > 0 AND
twin_count = 0`. `control-node`'s own toggle re-verified unchanged
afterward (it has 2 physical devices with no twin of their own, `pulse`/
`heartbeat`, but passes via its other 2 twinned devices, `led-green`/
`temperature` - same "some redirect happens somewhere on this node"
condition as before, not "every physical device needs its own twin").
`weather-node-01` toggled to `simulated: true` live afterward, confirmed
via the Nodes page (`Simulation` status pill, red toggle) and the
header's own blinking Simulation badge lighting up.

**Third follow-up, same day** - the user reported the Nodes page's own
switch could turn `weather-node-01`'s simulated mode OFF but not back
ON. Root cause: `NodesList.jsx`'s `Switch` disabled itself on
`!node.simulated && !node.has_simulated_twin` - `has_simulated_twin` was
the OLD, unfixed field (`EXISTS(... edgex_device_name_simulated IS NOT
NULL)`, still just "does any twin exist anywhere"), never updated when
the second follow-up above fixed the actual write-path guard. For a node
with zero physical devices this can never be true, so the switch stayed
permanently disabled for turning simulated ON, regardless of the PATCH
route itself now allowing it - the backend fix alone wasn't enough; the
frontend had its own, now-stale copy of the pre-fix rule guarding the
same decision.

Renamed the field to `can_enable_simulated` and gave it the exact same
`NOT EXISTS (physical device with no twin)` condition the PATCH guard
now uses - then simplified the PATCH handler itself to read
`node.can_enable_simulated` off the row `findNode` already returns
(`SELECT_NODE` computes it once) instead of running its own separate
count query, so there is now exactly one place this condition is
computed, not two that can drift apart again. `NodesList.jsx` updated to
match (`disabled`, `ariaLabel`). Live-verified via an actual UI click
this time (not the browser-console `fetch()` workaround the earlier
follow-ups used) - `weather-node-01`'s switch turned simulated ON
successfully, `Simulation` pill and header badge both lit up.

## 67. Devices expand row - a readOnly device's own simulated value is now editable in place, not just via Dev Simulator

2026-08-23. The user asked directly: with the simulated-value machinery
now working end to end for `weather-node-01`, could the expand row's
left "Value" table also let you edit a simulated device's value right
there, instead of needing the separate Dev Simulator page for the same
`PUT /devices/:id/simulate` write - "якщо це число - використовуємо
компоненту з кнопочками -input+" (their own name for `NumericStepper`),
with a per-device step, and - explicitly, since every other caller of
that component has a disabled display-only input - "Інпут в даному
випадку дозволений (not disabled)".

**`NumericStepper.jsx`**: new `editable` prop (default `false`, every
existing caller unaffected). When true, the input becomes a real typable
`CFormInput` - local `text` state, committed on blur or Enter (parses,
clamps to `[min, max]`, calls `onCommit` if the value actually changed).
Kept the render-time "sync `text` from a changed `value` prop" logic
*out* of a `useEffect` (`if (current !== syncedCurrent) { setSyncedCurrent(...); setText(...) }`
during render instead) - this codebase's stricter React Compiler-era
lint rules (`react-hooks/set-state-in-effect`) reject a plain setState
call inside an effect body, same class of rule `ProcessSettingsModal.jsx`
already has its own comments about. A second, unrelated lint error
(`react-hooks/immutability`) surfaced on the *pre-existing* `doStep`
function's own `runningValueRef.current = clamped` write purely from
`commitText` being declared nearby and also touching that ref - fixed by
not having `commitText` touch `runningValueRef` at all (it never needed
to: that ref only matters for a held-repeat's own running baseline, and
the existing `current`-tracking effect already re-syncs it once the
parent re-renders with the value `commitText`'s own `onCommit` produced).

**`DevicesList.jsx`**: new `SimulatedValueEditor` (own small component,
under the left "Value" `KeyValueTable`, only rendered when
`effectivelySimulated && device.capabilities?.readOnly && typeof value
=== 'number'` - the exact same class of device Dev Simulator's own
readOnly branch already targets, just reachable from this page too now).
Step is `device.capabilities?.step ?? 1` - `capabilities.step` was
already an existing per-device field (`DeviceCapabilities` interface,
`routes/devices.ts`; already read by DevSimulator's own `CustomSimulator`
branch for e.g. `light-regulator`'s slider) that the plain generic
`NumericStepper` path in DevSimulator never actually consulted (hardcoded
`step={0.5}` there regardless of device type) - this is the "personal
step" the user asked for, reusing that field rather than inventing a new
one. Write goes through the existing `api.simulateDevice()` (same route
DevSimulator uses) - no `reloadDevices()` afterward needed, since the
write already lands via the live `device` event `useDeviceLiveState`
subscribes to (every open tab, including this row's own, converges on
its own). Also fixed the left table's own "Value" row to read the same
live-overlaid `value` `DeviceRow` already computes for its collapsed-row
cell, instead of the one-time-fetch-only `fetched?.value` it used before
- those two could previously disagree indefinitely once any live event
arrived, which would have looked especially broken sitting directly
above a live-editable input showing the correct number.

**Weather-node's own devices** (`nexus-edge-aquarium`) got real
`step`/`min`/`max` values for the first time as part of this
(`temperature`: 0.5/-40/60, `humidity`: 1/0/100, `pressure`: 1, `light`:
50/0/4095) - both the migration file and a live `UPDATE` against the
already-seeded rows (migrate-extra's own idempotency means editing the
file alone doesn't retroactively touch a row that already exists).

Live-verified: typed `1200` directly into `weather-node-light`'s new
input and pressed Enter (no `+`/`-` click) - committed immediately,
visible in the collapsed row, the Value table, and the header's own
Simulation badge context all at once; clicked `+` once afterward and
confirmed it stepped by exactly 50 (`1200` -> `1250`), the configured
per-device step, not a hardcoded default.
## 68. `devices.name` uniqueness narrowed from global to per-node

2026-08-23. Reported inconvenient directly: `name` had a plain global
UNIQUE constraint (`devices_name_key`, the original column-level
`unique: true` from `1690000000001_create-devices-table.ts`, never
touched since) - meaning a second instance of any node type could never
reuse that type's own device names (e.g. a second `control-node`
re-seeding its own `...-led-green`-style names), confirmed as a real,
already-present limitation via every existing seed file (all name every
device `<node-type>-<slot>`, never `<node-instance>-<slot>`).

`name` is a separate column from `edgex_device_name` (each with its own
independent UNIQUE constraint) - `name` is the user-editable display
label (`PATCH /devices/:id/name`), `edgex_device_name` is what actually
goes to EdgeX and has to stay globally unique since that's EdgeX's own
requirement, untouched here. The Model State Validator
(`apps/api/src/validator.ts`) already resolved forbidden-state device
names via a node-scoped lookup (`findDeviceByNodeAndName`) - the app's
own business logic already only ever needed per-node uniqueness; the DB
constraint had simply been stricter than necessary.

New migration (`1690000000052_devices-name-unique-per-node.ts`) drops
`devices_name_key` and replaces it with TWO partial unique indexes, not
one plain composite `UNIQUE(node_id, name)`: Postgres treats every NULL
`node_id` as distinct from every other in a composite UNIQUE, so a plain
composite constraint would leave standalone devices (`node_id IS NULL`)
completely unconstrained by name instead of merely node-scoped - there's
no node for them to be scoped to. Confirmed with the user: standalone
devices keep their previous global-uniqueness behavior
(`devices_name_unique_standalone`, `UNIQUE (name) WHERE node_id IS
NULL`); node-attached devices get the new per-node scoping
(`devices_name_unique_per_node`, `UNIQUE (node_id, name) WHERE node_id
IS NOT NULL`).

`routes/devices.ts`'s rename route (`PATCH /devices/:id/name`) already
handled the unique-violation case generically (catch `23505`, return
409) - left its error message scope-neutral ("a device with this name
already exists") rather than claiming either "on this node" or
"globally", since which one actually fired now depends on whether the
device is node-attached, and the route has no cheap way to tell without
an extra query.

Live-verified directly against Postgres (not through the API - no
runtime "create device" route exists, devices are only ever created via
migrations): two devices on two different nodes now successfully share a
name; two devices on the SAME node with the same name still correctly
reject (`devices_name_unique_per_node` violation); two standalone
devices (`node_id IS NULL`) with the same name still correctly reject
(`devices_name_unique_standalone` violation) - all three cases confirmed
in a rolled-back transaction, no lasting test data left behind.

## 69. `nodes.seed_key` - target-project seed migrations no longer duplicate a Node on every `migrate-extra` re-run

2026-08-23, same day as §69, surfaced investigating a user report of
stale duplicate nodes in `nexus-edge-aquarium`'s own DB
(`control-node-01`/`weather-node-01`, both empty or nearly-empty
shells alongside the real, in-use `Main node control`/`Weather
Station`). Root cause: `nodes.name` has its own real UNIQUE constraint
(`nodes_name_key`), and every target-project seed `*.sql` file
(`001_seed_control_node.sql`, `002_seed_weather_node.sql`,
`003_seed_aquarium_light.sql`, all in `nexus-edge-aquarium`) matched its
Node INSERT via `ON CONFLICT (name)` - exactly the same idempotency
strategy already used for `devices.edgex_device_name`. The difference:
`devices.edgex_device_name` is deliberately never touched by the UI
(only `devices.name` is user-renameable), but Nodes have no such second,
UI-invisible identity column - `nodes.name` IS the only identity a Node
has, and it's just as user-renameable (`PATCH /nodes/:id/name`) as a
Device's own `name`. Once a seeded node got renamed via the UI (as both
of these had been, independently, at some earlier point), the literal
string in the seed file's `ON CONFLICT (name)` no longer matched any
existing row, and `migrate-extra`'s own re-run-every-container-start
design (`docker-compose.yml`'s own comment: "re-runs every *.sql file on
every container start") silently inserted a fresh, empty duplicate node
instead of recognizing the real one. `weather-node-01` additionally
picked up one duplicate DEVICE too (`weather-node-light-level`) - the
computed `light-level` device (§66, no `edgex_device_name` at all) has
no idempotency key of its own either, keyed only by `node_id` matching a
node it could no longer find (the very same rename problem, one level
down).

Fixed with a new nullable, unique `nodes.seed_key` column
(`1690000000053_add-nodes-seed-key.ts`) - the Node-level equivalent of
`devices.edgex_device_name`: a UI-invisible anchor only a seed
migration's own `ON CONFLICT` ever reads or writes, `name` stays exactly
as freely renameable as it always was. Each of the three target-project
seed files now leads with a one-time `UPDATE nodes SET seed_key = '<the
same literal string the file has always used for name>' WHERE type =
'<node type>' AND seed_key IS NULL` - this is what makes the fix
self-healing for every already-renamed deployment, not just future
ones: it backfills `seed_key` onto whatever the real, live node of that
type happens to be right now, however it's currently named, the very
first time the updated file runs. Every subsequent `(SELECT id FROM
nodes WHERE name = '...')` subquery in these files (device `node_id`
resolution, the computed device's own `NOT EXISTS` guard, the process
config's `nodeId`/`lightNodeId`/`panelNodeId`) switched to `WHERE
seed_key = '...'` too, since `name` can no longer be trusted to match
after a rename.

Cleaned up live in `nexus-edge-aquarium`'s own DB before writing the
fix: deleted the two empty node duplicates (`control-node-01`,
`weather-node-01`) plus a third, unrelated pre-existing empty
`control-node` duplicate found in the same pass (`System control`, same
root cause, from even earlier) and the one orphaned `weather-node-
light-level` device (`nodes.id → devices.node_id` is `ON DELETE SET
NULL`, not CASCADE - deleting the node alone left the device behind as
a newly-standalone row, needing its own explicit cleanup). Verified the
backfill+fix together afterward by running `migrate-extra` twice in a
row against the now-clean DB: first run reported `UPDATE 1` for each of
the four backfills (linking the real, already-renamed nodes to their
seed_key) and `INSERT 0 0` for every node/device insert that would
previously have duplicated; second run reported `UPDATE 0` for every
backfill (already linked) and `INSERT 0 0` throughout - full end-to-end
idempotency confirmed, not just reasoned about. `processes` GET
afterward confirmed every affected process still resolves its
`nodeId`/device references correctly and remains non-critical.

