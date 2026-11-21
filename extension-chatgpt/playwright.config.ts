import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  outputDir: "../../.work/tmp/playwright-results-chatgpt",
  retries: 0,
  reporter: "line",
  workers: 1,
  timeout: 60_000,
});
