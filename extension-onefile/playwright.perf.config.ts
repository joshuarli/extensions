import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  testMatch: /perf-.*\.spec\.ts/,
  outputDir: "../../.work/tmp/playwright-results",
  retries: 0,
  reporter: "line",
  timeout: 180_000,
});
