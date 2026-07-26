# packages/

Shared libraries consumed by `apps/` and `plugins/` (AGENTS.md section 2).
Empty on purpose so far - nothing has needed sharing across package
boundaries until now. `tsconfig.base.json` (repo root) and
`eslint.config.base.mjs` (repo root) already cover the "shared base,
per-app extend" need for build/lint tooling without a package here.

First real package planned for this folder: `packages/contracts` - the
handful of cross-service DTOs (process/device/message-level shapes) that
have already drifted out of sync between `apps/api` and
`apps/orchestrator` at least once (see to-do.txt's refactoring notes,
Etap 1/Phase 2).
