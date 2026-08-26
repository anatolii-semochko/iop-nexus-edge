# Development Log

A distilled, chronological record of the architectural decisions behind
this platform - what was decided and why, real bugs found along the way,
and what was deliberately left undone at each point. Not an exhaustive
changelog: implementation detail, verification steps, and the current
state of any given subsystem live in `AGENTS.md` (the canonical, living
reference - trust it over this log if the two ever disagree) and in git
history/commit messages. This file exists so the reasoning behind a
decision doesn't have to be re-derived or re-asked for later.

Distilled from the project's own working journal (`../AGENTS_TO_DO.md`,
one level up, gitignored, Ukrainian) - see that file (and its linked
`archive-development/AGENTS_DEV_*.md` chronology) for the full
unfiltered back-and-forth if more context on a specific exchange is ever
needed.

## 2026-07-22 - Project scaffold

Monorepo (pnpm workspace + Turborepo), plain git (not a fork of anything),
Apache-2.0, Node 22 LTS pinned. Platform-only scaffold - no target system
(the first one, a Smart House project, is deliberately a separate,
future repo, not a folder in this one).

EdgeX Foundry chosen as the protocol/hardware abstraction hub, deployed
for real from day one (not stubbed) - Palau 4.0.2, `no-secty` profile
(security stack disabled; this platform's own auth layer handles
authn/authz, not EdgeX's). CANable Pro V1 (USB-to-CAN) is the first
physical bus target, ordered but not yet in hand at time of writing.

Postgres/Redis/RabbitMQ deployed immediately rather than starting
in-memory - Device Registry needed real persistence from the start.

CoreUI's free React admin template (Vite + `@coreui/react`) adopted for
`apps/ui`, chosen over the static-HTML CoreUI bootstrap package once it
became clear the latter had no React underneath it at all.

## 2026-07-23 - Physical/Virtual device architecture

Rejected EdgeX's own `device-virtual` service (generic random bool/int
simulation) in favor of a custom device-service hosting realistic,
domain-specific simulators alongside the real transport. Landed on:

- A custom Go EdgeX device service (`apps/device-service`, EdgeX Device
  SDK) hosts both the real CAN transport and a **Virtual Node Runtime**
  (a generic in-memory get/set state store standing in for hardware) side
  by side, switching per device via a Postgres-configured backend flag.
  This superseded an earlier "Digital Twin" concept from the original
  vision doc (`docs/PROJECT_MASTER-1.1.md` section 8) - the twin idea
  duplicated what the Virtual Node Runtime already does more simply.
- The **Model State Validator** (forbidden-state rules, e.g. "heating and
  cooling can't be active at once") lives in-process inside the Devices
  API, not as its own service - the safety check needs the same Redis
  state the write path already has, not a network hop.
- Physical/virtual is a **config-time** device property, not something
  toggled live from the UI - switching a device from physical to virtual
  mid-operation would strand a real actuator with nothing watching it.

**Node & Device entities** (`AGENTS.md` section 7): both first-class in
the Postgres Device Registry, `Device.nodeId` nullable (a
directly-connected device has no node). `devices/` (repo folder) holds
device *type* definitions (design-time, versioned in git - contract,
EdgeX profile, safety rules, UI control/simulator components, docs,
changelog); the Device Registry holds device *instances* (runtime).
`devices/nodes/<type>/devices/<type>/` for node-attached devices,
`devices/standalone/<type>/` for standalone ones.

`apps/device-service` implemented: NexusDriver (EdgeX `ProtocolDriver`),
SocketCAN transport (no cgo), the Virtual Node Runtime. Verified live:
profile/device registration, resource read/write round-tripping through
the Virtual Node Runtime. The CAN path was written but never exercised
against real hardware (none available yet).

**Real bug found and fixed**: the EdgeX SDK only calls `AddDevice` for
devices new to metadata in the current run - a restart against an
already-registered device never re-fires it, so the Virtual Node Runtime
(which relied on `AddDevice` to seed initial state) came up with "no
runtime registered" after any restart. Fixed by seeding lazily on first
read/write instead of at `AddDevice` time.

**Transport abstraction**: CAN was initially hardcoded directly into the
driver; refactored into a `PhysicalTransport` interface so RS485/Modbus/
MQTT can be added later without touching driver internals. Protocol
properties split into `protocols.backend.mode` (physical|virtual) and
`protocols.transport.type` (e.g. `"can"` plus transport-specific fields,
opaque to the driver).

**Devices API vertical slice** (Postgres Device Registry -> `apps/api` ->
`apps/ui`), all three phases in one pass:
- `nodes`/`devices` tables (`node-pg-migrate`, TypeScript migrations),
  `backend` check-constrained to `physical|virtual`, `capabilities` jsonb.
- `GET /nodes(/:id)`, `GET /devices` (one core-metadata call, not N+1),
  `GET /devices/:id` (live values read in parallel), `PUT
  /devices/:id/resources/:resource` (proxied to EdgeX core-command).
- UI: Nodes/Devices/Dev Simulator pages, relative `/api/*` fetches (no
  CORS), nginx reverse proxy with the API port templated via `envsubst`.

**Model State Validator wired into the write path**: forbidden-state
rules (`{when: {resource, equals}, conflictsWith: {resource, equals}}`)
declared in `devices.capabilities.forbidden` (Postgres), checked before
every write, `409` on conflict. Verified with the smoke-test device's
Heater/Cooler interlock.

**Dual Devices Model** (`apps/api/src/dualDevicesModel.ts`, Redis-backed,
per `(deviceId, resource)` not per-device): `AUTO` (orchestrator-driven,
`valueAuto`) vs `MANUAL` (UI override, `valueManual`) per resource, an
aggregate `SERVICE` state at the system level when some resources are
auto and others manual. **Real bug**: the first `systemMode()`
implementation only counted resources that had ever touched Redis, so a
single manual override among four resources reported `MANUAL` instead of
the correct `SERVICE` - fixed by sourcing the full resource list from
Postgres (the source of truth) rather than from whatever Redis happened
to have touched.

**Two more real bugs fixed same day**: (1) a `PUT` with no `value` in the
body serialized to Redis as a literal empty string via
`JSON.stringify(undefined)`, which then failed to parse on the next read
- fixed with explicit `value !== undefined` validation on both write
routes plus try/catch around decode; (2) a read-only-resource write
(EdgeX 405) was reaching clients as an opaque 500 - fixed by carrying the
real EdgeX status through (`EdgeXError`), and a bodyless `POST .../release`
was rejected by Fastify because the client always set
`Content-Type: application/json` even with no body - fixed by only
setting that header when a body is actually present.

**Messaging Service** (`apps/messaging-gateway`, RabbitMQ + WebSocket):
kept RabbitMQ (already deployed, already a topic exchange) rather than
adopting MQTT retained messages, NATS, Centrifugo, or Socket.IO - none of
those solved a problem this project actually had at the time. One
exchange (`nexus.events`), routing key
`<domain>.<entityId>.<resource?>.<eventType>`, flat JSON envelope. No new
Postgres entities for senders/receivers/groups/ACLs - routing-key
patterns on existing fields cover grouping for now, real
multi-user access control deferred. Redis key with TTL doubles as both
"last known value" cache and heartbeat (expiration = offline). UI wired
up: `liveSocket.js` (auto-reconnect WS), `useDeviceLiveState`, a raw
`/live-events` feed page.

**Dev Simulator overhaul + first real device type**: `devices.
capabilities.resources` became a real object shape
(`{name, readOnly?, min?, max?, step?}`) instead of a bare string array -
a `readOnly` resource (a pure sensor) has no AUTO/MANUAL concept at all,
rather than a misleading default-AUTO. New `PUT
.../resources/:resource/simulate` endpoint writes straight to EdgeX for
such sensors, bypassing the Dual Devices Model entirely.
`devices/standalone/actuator/light-regulator/` became the platform's first real
(non-smoke-test) device type, following the full type-vs-instance layout
above. **Real bugs found**: EdgeX device-profile `minimum`/`maximum` must
be YAML numbers, not quoted strings (a stringified `"0"` broke profile
parsing entirely); the Go driver's `toInt64` only accepted the native
types a fresh YAML-seeded value arrives as, not the `int32`/`uint32`
types the Virtual Node Runtime re-encodes a value as after a round trip
- never surfaced before because no `Int32`/`Uint32` resource had existed
until this one. EdgeX v2+ always returns floats in scientific notation
(`"2.15e+01"`) - normalized once, at the API boundary
(`apps/api/src/edgex.ts`), not left for every consumer to handle.

**First orchestration** (`apps/orchestrator`, 1s tick loop, HTTP-only -
no direct Postgres/Redis/EdgeX access, by design): two processes on the
smoke-test device - `temperature-control` (controllable, drives
Cooler/Heater to keep Temperature within `[min, max]`) and
`temperature-monitor` (permanent, wider safety margin, raises a
`critical` flag independently - deliberate defense-in-depth against the
controllable process's own actuation failing). `processes` table:
`type` (`controllable|permanent`), `kind` (a fixed dispatch string, not
a plugin system), `actions`, `device_id`, `config` jsonb. Redis-backed
`status`/`critical` published to `nexus.events` only on actual change,
not every tick.

**Real bug found by the user, not obvious from testing**: a critical row
wasn't highlighting red despite the backend logic being correct (verified
by direct `curl`) - Bootstrap/CoreUI's own table hover/striping CSS writes
`--bs-table-bg` at the `<td>` level, which silently overrides a
`className="bg-danger-subtle"` on the `<tr>`. Fixed with CoreUI's own
`color="danger"` prop on `CTableRow`, which sets the same CSS variable
correctly - worth remembering for any future row-highlighting need.

## 2026-07-24 - Pagination, auth, CoreUI cleanup

Three steps done together (all touched shared UI infrastructure):

- **Client-side pagination/filtering toolkit** (`hooks/useDebouncedValue`,
  `usePagination`, `components/table/TablePagination` +
  `TableSearchInput`, `utils/format.js`) - client-side confirmed
  appropriate given the actual data volumes at this stage.
- **UI login** (JWT in an httpOnly, `SameSite=Strict` cookie - not
  `localStorage`; `bcryptjs`, pure JS, no native build toolchain needed on
  ARM/Raspberry Pi; a single fixed-TTL JWT, no refresh tokens or Redis
  session store - this is a UI gate only). `users` table with `roles` as
  a Postgres array, not a delimited string. Protected `admin`/`system`
  accounts (never deleted/deactivated). Explicitly scoped to the UI only
  - API/controller-level authorization is a separate, larger, deferred
  task.
- **CoreUI demo scaffolding removed**: every demo section, unused chart
  library and its dependents, demo avatars - roughly halved the
  production bundle's largest chunks. Dashboard/Docs left as minimal
  placeholder pages; Devices/Orchestration/Settings are the real menu
  groups.

## 2026-07-25 - Metrics over the bus, WEM system

**Resource Monitor metrics moved off UI polling**: the UI had been
polling the API once a second for CPU/RAM/disk readings - moved to the
same live WebSocket feed every other value already uses, since the
orchestrator was already publishing metrics unconditionally every tick
regardless of whether the value changed.

**WEM (Warnings/Errors/Messages)** - the first pass of what became the
platform's alarm/notification model. `process_messages` table: `code`
(stable dedup key), `level` (a placeholder always `1` at this point -
levels 2-4 wait on Message Levels config that doesn't exist yet),
`hidden` (dismissal), `resolved_at` (`NULL` = active), a partial unique
index enforcing "at most one active row per process+type+code" at the DB
level. `processMessages.syncActiveMessages(processId, type, entries,
source)` - the shared reconciliation mechanism: a process reports its
*complete current set* of active codes each tick, the function diffs
that against the DB in one transaction and only publishes when something
actually changed. One deliberate exception, called out by the user
directly: a `type: "message"` entry doesn't auto-resolve when missing
from a later call - unlike a threshold-based warning/error, a message is
a one-shot notification that only clears via explicit dismissal.

Also added: `device_command_logs`/`sensor_reading_logs` (append-only,
best-effort - a logging failure never breaks the operation it's
logging). A new expandable UI row per process shows its active WEM
entries when present, sorted error > warning > message.

**Real bug fixed same day**: `temperature-monitor` had never actually
called `syncActiveMessages` at all, only ever raised the boolean
`critical` flag - so Temperature Control's WEM row stayed empty even
during a real critical condition. Fixed, and at the same time the
`linkedProcessIds` mechanism (the monitor process's `critical` flag
bleeding onto the controllable process's own row) was removed entirely,
per the user's own explicit call that it was a workaround that didn't
belong in the model - each process now only ever reports its own state.

## 2026-07-26 - Processes page rework, process-state broadcast, notification center, Active Zummer

The single busiest day in the project so far; grouped here by theme
rather than strictly chronologically.

**Processes page: tabs, Dashboard, three group entities**
(`AGENTS.md` section 23). Landed on three genuinely distinct grouping
concepts after an early draft conflated two of them:
- **Process Groups** (unchanged) - the technical system a process
  belongs to (heating, lighting, aquarium, ...).
- **Tab Groups** - an operator's own curated workspace, ordered
  (`position`), each becomes a dynamic page tab. Independent of Process
  Groups - an operator can watch processes spanning several technical
  groups at once.
- **Message Groups** - WEM routing (which recipient gets which
  notifications, delivery mechanism not built yet) - no ordering, not
  tied to either of the above.

Dashboard tab: any process that has ever had an active WEM entry stays
listed until a user explicitly clears it via its row's X, which only
succeeds once the process is genuinely back to zero active entries
(enforced server-side, not just as a UI-disabled state).

Follow-up fixes: the filter bar used to disappear entirely on a
zero-result search (an early-return swapped out the whole component,
reset button included); a shared `status` (active/inactive) filter was
added; row action buttons were reordered and unified into one
non-wrapping flex container; `IconButton`'s icon centering used to make
it a flex container, which shrinks a button's auto-height below the
line-height math every text-labelled sibling control uses - fixed by
centering the icon itself (`align-middle`) instead of flexing the
button.

**Event Bus analysis and process-state broadcast rework**
(`AGENTS.md` section 24). An audit turned up real scatter on the
`process.*` domain within `nexus.events`: five different routing keys,
five different payload shapes, and - unlike the device domain - no
Redis-backed snapshot at all for a freshly-connecting WebSocket client.
The user then asked the sharper architectural question directly: process
state has exactly two consumers, ever (this API's own REST layer, and
the messaging gateway) - why route it through a message broker built for
potentially-many device/command consumers at all? Agreed, and pulled
process state off RabbitMQ entirely:

- One Redis **hash** per process (`process:{id}:public`), replacing five
  separate keys - one `HGETALL` for the complete state.
- A fleet-wide snapshot assembler (`processBroadcast.ts`) decides when to
  push: a periodic timer, an "urgent" trigger (critical/warning
  transition, a new active WEM entry - debounced 250ms to coalesce a
  burst of writes from one tick), or an explicit forced broadcast.
- The messaging gateway relays the cached snapshot over the same
  WebSocket device events already use, via Redis Pub/Sub notifying it to
  re-read - `nexus.events`/RabbitMQ is device/node domain only again.

**Real bug found by the user after this landed**: clearing a process off
the Dashboard, then having its condition recur, never brought it back -
`DashboardTab.jsx` had only ever read `dashboard_flagged_at` once, from
the initial REST load at mount, never refreshed. Fixed by adding the flag
to the live broadcast and reading it through a new
`useProcessesLiveState()` hook, merged as `liveEntry ?
liveEntry.dashboardFlaggedAt : restValue` rather than `??` - the field is
a nullable timestamp, and `??` would incorrectly treat a legitimate
`null` (not flagged) as "missing, fall back to stale REST".

**Notification center** (header WEM icons + popup,
`AGENTS.md` section 25): three icons (messages/warnings/errors),
warnings/errors also blink when active anywhere in the fleet. One popup:
type selector, active/new/all tabs, server-side pagination (the first
one in this app - every other table here is client-side, small enough
not to need it). Read-tracking added for the first time (`hidden_by`/
`hidden_at`), shared (not per-user) by explicit confirmation. Unread
counters live in Redis, riding the same fleet broadcast as everything
else rather than a separate channel.

**Real bug found live**: the messaging gateway's snapshot relay function
reconstructs the envelope field-by-field rather than spreading it, and
simply forgot to add the new `unreadCounts` field when it was introduced
- Redis and the WebSocket payload both had the right data, it just got
dropped in transit. Fixed by adding the field explicitly. Two rounds of
cosmetic follow-up: fixed popup height, added bulk-select "mark as read",
fixed both icons blinking together when only one severity was actually
active (one shared boolean had been driving both), replaced a subtle
opacity-fade blink with a solid pulsing disc for visibility. A circular
import between `NotificationCenter.jsx` and its modal (through a shared
constant) crashed the whole page white once a new top-level usage
exposed it - fixed by extracting the constant into its own
dependency-free module.

**Shared visual atoms** (`AGENTS.md` section 26): `StatusIndicator`
(black-ringed circle, grey when inactive / a caller-supplied color when
active), `BuzzerIndicator` (built ahead of an actual consumer, see Active
Zummer below), `Switch` (a large on/off toggle, replacing the button pair
specifically for the ON/OFF action set - the original per-action button
rendering was kept intact for any future action set, not deleted),
`ResetFiltersButton` (fixed a real bug: passing `variant={undefined}` to
`IconButton` does not override its own `variant = 'outline'` default
parameter the way one might expect - the button had been rendering
outlined/white the whole time instead of solid yellow).

**Active Zummer** - the platform's first sound-output device and process
(full design in `AGENTS.md`'s Active Zummer section). A single-resource
virtual actuator (`devices/standalone/indicator/active-buzzer/`, same real-device-
type layout as light-regulator), driven by a new `active-buzzer` process
kind against a shared, reusable alarm-priority policy
(`apps/orchestrator/src/alarmPolicy.ts`) - error outranks warning today,
by an ordered list rather than a hardcoded conditional, specifically so a
richer priority scheme can be dropped in later without touching callers.
Deliberately keyed off each process's raw `critical`/`warning` flags, not
its `messages` list - the latter excludes anything a user has dismissed
in the notification center, and a dismissed notification must never
silence a still-active physical alarm. `constant` mode holds the buzzer
on directly; `shortBeep`/`longBeep` run a private per-process timer
(independent of the orchestrator's shared 1-second tick) so the buzzer
can pulse on a sub-second cadence the shared tick can't provide on its
own.

## 2026-07-26 (later) - Refactoring: audit and Phase 0

With the first hardware order placed but not yet arrived, and a
significant amount of iterative rework behind the project, a deliberate
four-stage refactor was started: analyze, discuss, plan, execute
(mirroring `AGENTS_TO_DO.md`'s own structure). The architecture audit
(read directly, verified by running the actual tools, not guessed)
turned up several real, previously-unnoticed gaps:

- **No CI at all**, despite it being an original requirement.
- **ESLint was entirely unconfigured** for 3 of the 4 Node services
  (`apps/api`, `apps/orchestrator`, `apps/messaging-gateway`) - the
  `lint` script crashed immediately rather than reporting issues. Every
  "lint clean" claim made about those services in earlier work in this
  log actually only meant `tsc --noEmit` had passed.
- **`vitest` was wired up with zero test files anywhere** in the repo -
  running it exited with failure on every service that had it configured.
- **No shared type-contract layer between services** - `packages/` was
  scaffolded for exactly this on day one and has stayed empty; a concrete
  DTO shape (`ProcessRecord`) had already drifted between `apps/api` and
  `apps/orchestrator` at least once as a direct result.
- A recurring **bug class**, not a single bug: reading a live-updatable
  field once from REST at mount and never refreshing it caused the same
  shape of regression three separate times (a Dashboard flag, a
  Dashboard button's disabled state, and the original REST-to-broadcast
  migration itself).

None of these were judged to be *wrong* architecture at the root, on
reflection - each is either already-planned work (an orchestrator
heartbeat/watchdog and command-path authorization were already on the
user's own list) or missing tooling layered on top of an otherwise sound
design, not a flaw in the design itself. The one genuinely open question
- whether the process-kind dispatch needs a real plugin mechanism now or
can stay a fixed map - was deferred: no second target project needs it
yet, revisit when one does.

**Phase 0 (tooling, the enabling step before any further restructuring)**
shipped first, deliberately, so the rest of the refactor has something to
verify against: working `eslint.config.*` for the three backend services
(plus two real, previously-unnoticed lint findings actually fixed, not
just silenced), the first real test file in the repo
(`alarmPolicy.test.ts`), and a GitHub Actions CI workflow, verified to
actually pass end-to-end before being considered done.
