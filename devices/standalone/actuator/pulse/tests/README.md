# Tests

No automated tests yet - consistent with `apps/device-service` and every
other device type in this repo. Verification is live `docker compose`
runs: provisioned, written every tick via `setDeviceAuto` from the
control-node's own permanent process, confirmed to round-trip through
EdgeX core-command (AGENTS.md section 9).
