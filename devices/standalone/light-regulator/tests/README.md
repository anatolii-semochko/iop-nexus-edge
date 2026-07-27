# Tests

No automated tests yet - consistent with `apps/device-service`, which also
has none today (verification there has so far been live `docker compose`
runs, not a test suite). This device type was verified the same way:
provisioned live, read via `GET /devices/:id`, and its `Level` value
written via `PUT /devices/:id/simulate` and confirmed to round-trip
through EdgeX core-command and appear on the messaging bus (AGENTS.md
section 9).
