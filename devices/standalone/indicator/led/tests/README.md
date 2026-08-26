# Tests

No automated tests yet - consistent with every other device type in this
repo. Verified live as part of the Alarm Annunciator node/process
(AGENTS_TO_DO.md, 2026-08-02): `PUT /devices/:id/auto` toggles state the
same as any other Bool actuator via `curl`, and the annunciator process
itself drives all 16 instances every tick.
