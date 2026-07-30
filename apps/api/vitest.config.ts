import { defineConfig } from "vitest/config";

// `passWithNoTests` - this service has no test files yet (syncActiveMessages/
// dualDevicesModel's logic needs a live Postgres/Redis to test meaningfully,
// deliberately deferred - see AGENTS_TO_DO.md's Etap 1 refactor notes). Without
// this, `vitest run` exits 1 on "no test files found", which would break
// CI (Fаза 0.4) the instant it's wired up, for a reason unrelated to any
// actual regression.
export default defineConfig({
  test: {
    passWithNoTests: true,
  },
});
