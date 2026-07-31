# Tests

No automated tests yet - consistent with every other device type in this
repo. Verified live (both as part of the original bundled fixture and
again after the 2026-07-28 Device/Node split): `PUT /devices/:id/auto`
from a real Temperature Control tick turns this device on/off correctly,
and writing it to `true` while `../cooler` is also `true` (or vice versa)
is rejected with a `409` by the Model State Validator reading the Node's
`safety.yaml`/`nodes.forbidden` rule - confirmed with `curl` directly
against the API, not just inferred from code.
