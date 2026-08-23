/**
 * Light level - atomic, COMPUTED Device type (AGENTS.md section 7/30/32),
 * added 2026-08-23 alongside `../light` for the "weather-control" process
 * (`Node Weather Control.txt`, AGENTS_TO_DO.md). Unlike every other
 * device type in this library, this one has no physical or virtual EdgeX
 * backend at all - there is no `edgex-device-profile.yaml` next to this
 * file, deliberately. Its value is derived every orchestrator tick by the
 * `weather-control` process from `../light`'s raw reading against a set
 * of admin-configured zone boundaries (that process's own `config.zones`),
 * and pushed directly into this Device via `PUT /devices/:id/reading`
 * (apps/api/src/routes/devices.ts, a thin wrapper over
 * dualDevicesModel.publishReading() - the same cache-refresh-and-publish
 * primitive the Dev Simulator's `.../simulate` route already used, now
 * reused for a process-driven write instead of a human-driven one).
 *
 * `readOnly: true` here is doing different work than on a real sensor
 * Device: there, it means "nothing commands this, only hardware sets it".
 * Here it means "nothing EXTERNAL commands this" - only the
 * `weather-control` process (via its own reading route, not the ordinary
 * AUTO/MANUAL `PUT /devices/:id/auto` path, which requires a resolvable
 * EdgeX device and would reject this readOnly Device outright) is allowed
 * to change it. Other processes (e.g. a future outdoor-lighting
 * controller) read it the same way they'd read any other Device - by ID,
 * via `GET /devices/:id` - so a shared, canonical light-level classification
 * only needs computing once, not re-derived by every consumer.
 */
export const lightLevelContract = {
  deviceType: 'light-level',
  readOnly: true,
  valueType: 'String',
  units: 'level',
  description: 'Categorical daylight level, derived from ../light by the weather-control process',
  enum: ['very-sunny', 'sunny', 'medium', 'overcast', 'dusk', 'dark'],
}
