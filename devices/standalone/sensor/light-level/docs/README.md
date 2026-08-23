# Light level

Atomic, **computed** Device - a categorical daylight-level classification,
one of `very-sunny`/`sunny`/`medium`/`overcast`/`dusk`/`dark`. Added
2026-08-23 alongside `../light` for the "weather-control" process
(`Node Weather Control.txt`, AGENTS_TO_DO.md).

## Behavior

- Single value, `String` enum (see `contract.schema.ts`'s own `enum`
  list).
- `readOnly: true`, but not in the usual sense (see `contract.schema.ts`'s
  own comment) - it has no hardware or EdgeX backend whatsoever, so it
  isn't "read-only because a sensor drives it". It's read-only because
  only the `weather-control` process is allowed to change it: every
  orchestrator tick, that process reads `../light`'s current raw value,
  classifies it against its own configurable zone boundaries
  (`weather-control`'s `config.zones`), and writes the result here via
  `PUT /devices/:id/reading` - a new internal route
  (`apps/api/src/routes/devices.ts`) that calls
  `dualDevicesModel.publishReading()` directly, bypassing both the
  ordinary AUTO/MANUAL path (`PUT /devices/:id/auto`, which requires a
  resolvable EdgeX device and explicitly rejects readOnly devices) and the
  Dev Simulator's `.../simulate` path (reserved for a human simulating a
  sensor, not a process computing a derived value).
- Intended to be read by ID from other processes' own config (the same
  pattern `control-node/process.ts` already uses for
  `temperatureDeviceId`/`humidityDeviceId`) - e.g. a future
  outdoor-lighting-control process would take this Device's ID as its own
  `lightLevelDeviceId` config field, rather than re-deriving thresholds
  from `../light`'s raw value itself. One canonical classification, reused
  by every consumer.
- Has no `.../simulate` route usage and is never itself simulated
  directly - to test it, simulate `../light`'s raw value instead and watch
  this Device's value follow, once per orchestrator tick.

## Physical mapping

None - this Device has no physical or virtual EdgeX counterpart at all,
unlike every other Device type in this library. No
`edgex-device-profile.yaml` exists next to this file for that reason.

## Provisioning

Same as `../light`: a Postgres seed migration creates this Device row
(`backend` is not meaningful here - there is nothing to back it - but the
column still needs *some* value; treat it the same as `virtual`), with no
`edgex_device_name` set. `weather-control`'s own process config then
references this Device's ID as `lightLevelDeviceId`.
