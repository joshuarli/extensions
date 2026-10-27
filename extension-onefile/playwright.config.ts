import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  testIgnore: /perf-.*\.spec\.ts/,
  outputDir: "../../.work/tmp/playwright-results",
  retries: 0,
  reporter: "line",
});
