# Tests

No automated tests yet - consistent with `apps/device-service` and every
other device type in this repo. Verification is live `docker compose`
runs: `weather-control` process ticks, reads `../light`'s current value,
classifies it against its own `config.zones`, and calls
`PUT /devices/:id/reading` - confirmed by watching this Device's value
change on `GET /devices/:id` and on the messaging bus (AGENTS.md section
9) as the raw light reading is simulated across zone boundaries via
`../light`'s own `.../simulate` route.
