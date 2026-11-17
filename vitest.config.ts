import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["extension-*/test/**/*.test.ts", "lib/test/**/*.test.ts", "x-archive-core/test/**/*.test.ts", "x-archive-cli/test/**/*.test.ts", "onefile-cli/test/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["**/*.browser.test.ts"],
    environment: "node",
  },
});
