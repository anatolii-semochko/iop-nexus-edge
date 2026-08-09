# Tests

No automated tests yet - consistent with `apps/device-service` and every
other device type in this repo. Verification is live `docker compose`
runs: provisioned, read via `GET /devices/:id`, and confirmed to
correctly drive `POST /nodes/heartbeat` (a change in value updates
`heartbeatLastSeenAt` on `GET /nodes`) via the control-node's own
permanent process.
