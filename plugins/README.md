# plugins/

Protocol/device-driver/UI/storage/AI plugins (AGENTS.md section 2/4).
Empty on purpose - the platform's process/device "kind" dispatch is
today a fixed, hardcoded map (`apps/orchestrator/src/index.ts`'s
`RUNNERS`, `apps/ui`'s `KIND_PANELS`/`DEVICE_TYPE_CONTROLS`), explicitly
not a generic plugin system yet (AGENTS.md section 4's "plugin
lifecycle" note).

Revisit once a real target project built on this platform (e.g. the
planned Smart House) needs its own process/device kind without changing
and redeploying `apps/orchestrator` itself - premature to design a plugin
loader against a single hypothetical consumer today.
