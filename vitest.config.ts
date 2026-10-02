import { playwright } from "@vitest/browser-playwright";
import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

const systemChromiumPath = process.env["CHROMIUM_BINARY_PATH"] ??
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  browserProvider = playwright(
    existsSync(systemChromiumPath) ? { launchOptions: { executablePath: systemChromiumPath } } : undefined,
  );

export default defineConfig({
  optimizeDeps: { include: ["effect"] },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["extension-*/test/**/*.test.ts"],
          exclude: ["**/*.browser.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          include: ["extension-*/test/**/*.browser.test.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: browserProvider,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
