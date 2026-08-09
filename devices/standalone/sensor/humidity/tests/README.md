# Tests

No automated tests yet - consistent with `apps/device-service` and every
other device type in this repo. Verification is live `docker compose`
runs: provisioned, read via `GET /devices/:id`, value set through
`PUT /devices/:id/simulate` for a virtual instance (or a real CAN frame
for a physical one) and confirmed to round-trip through EdgeX
core-command and appear on the messaging bus (AGENTS.md section 9), and
confirmed to correctly drive the control-node's own permanent monitor
process reading it.
