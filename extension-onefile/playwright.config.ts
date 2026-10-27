import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  outputDir: "../../.work/tmp/playwright-results",
  retries: 0,
  reporter: "line",
});
