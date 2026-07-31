# Tests

No automated tests yet - consistent with `apps/device-service` and every
other device type in this repo, none of which have any today (verification
has so far been live `docker compose` runs, not a test suite). This device
type was verified the same way, both as part of the original bundled
`example-virtual-sensor-01` fixture and again after the 2026-07-28
Device/Node split: provisioned live, read via `GET /devices/:id`, and its
value written via `PUT /devices/:id/simulate`, confirmed to round-trip
through EdgeX core-command and appear on the messaging bus (AGENTS.md
section 9), and confirmed to correctly drive the "temperature-control"/
"temperature-monitor" processes reading it as their `sensorDeviceId`.
