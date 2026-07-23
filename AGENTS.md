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
- Redis 7 (Dual Devices Model state store)
- RabbitMQ 4 (Event Bus)
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
own (it has no node-level project to be included into). Empty for now — this
is the convention to follow once the first real device type is built; no
folders under `devices/` exist yet.

## 8. Running the stack

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
