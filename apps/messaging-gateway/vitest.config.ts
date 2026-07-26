import { defineConfig } from "vitest/config";

// See apps/api/vitest.config.ts's identical comment - no test files here
// yet either, `passWithNoTests` keeps that a neutral pass, not a CI
// failure unrelated to any actual regression.
export default defineConfig({
  test: {
    passWithNoTests: true,
  },
});
