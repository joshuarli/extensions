import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["extension-*/test/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["**/*.browser.test.ts"],
    environment: "node",
  },
});
