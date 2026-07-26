# Tests

No automated tests yet - consistent with every other device type in this
repo. Verified live: provisioned, read via `GET /devices/:id`, driven AUTO
by the `active-buzzer` process (an active fleet-wide error/warning
condition simulated via the existing Dev Simulator, confirmed to toggle
`Buzzer` true/false on the expected `constant`/`shortBeep`/`longBeep`
cadence), and confirmed to round-trip through EdgeX core-command and
appear on the messaging bus (AGENTS.md section 9).
