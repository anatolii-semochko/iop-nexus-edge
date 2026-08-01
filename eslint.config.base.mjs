// Shared ESLint base for the plain Node/TS backend services (apps/api,
// apps/orchestrator, apps/messaging-gateway) - same "shared base + per-app
// extend" pattern already used for tsconfig.base.json, not a copy-pasted
// config per service. Deliberately NOT the React/JSX config apps/ui owns
// (eslint.config.mjs there) - these services have no JSX/browser globals.
//
// Non-type-checked `tseslint.configs.recommended`, not `recommendedTypeChecked`
// - getting real linting running at all (previously eslint.config.* didn't
// exist for these 3 services, so `pnpm lint` crashed instead of reporting
// issues) is the goal here; type-aware linting needs `parserOptions.project`
// wired per app and is a reasonable later enhancement, not a blocker for
// this first pass.
//
// No Prettier integration here on purpose - apps/ui's eslint-plugin-prettier
// enforces ITS OWN style (no semicolons, single quotes), which does not
// match the semicolons/double-quotes already used throughout these three
// services' existing source. Adopting a new formatting mandate is a
// separate, explicit decision, not a side effect of "make lint runnable".
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(...tseslint.configs.recommended, {
  languageOptions: {
    globals: { ...globals.node },
    ecmaVersion: "latest",
    sourceType: "module",
  },
  rules: {
    // Matches this codebase's own established convention of prefixing a
    // deliberately-unused binding with `_` rather than removing it - both
    // for function args kept for call-shape symmetry (e.g. processRegistry.
    // ts's setStatus/setMetrics `_source`) and for a destructured field
    // renamed only to exclude it (e.g. routes/auth.ts's `password_hash:
    // _passwordHash` when stripping it before returning a public user).
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
  },
});
