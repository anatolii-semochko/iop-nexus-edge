import { defineConfig } from "vitest/config";

// Same as apps/api/vitest.config.ts - not needed today (alarmPolicy.test.ts
// exists), added for consistency so this service doesn't start failing CI
// on "no test files found" the moment a test file is temporarily absent.
export default defineConfig({
  test: {
    passWithNoTests: true,
  },
});
