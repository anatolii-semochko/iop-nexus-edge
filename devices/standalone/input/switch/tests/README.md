# Tests

No automated tests yet - consistent with every other device type in this
repo. Verified live (both as part of the original bundled fixture and
again after the 2026-07-28 Device/Node split): `PUT /devices/:id`,
`PUT /devices/:id/auto`, and `PUT /devices/:id/simulate` all work against
this device the same as any other Bool actuator, via `curl` directly
against the API. No forbidden-state interaction to verify - this device
has none.
