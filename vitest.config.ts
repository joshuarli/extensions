import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["extension-*/test/**/*.test.ts", "lib/test/**/*.test.ts", "x-archive-core/test/**/*.test.ts", "x-archive-cli/test/**/*.test.ts", "onefile-cli/test/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["**/*.browser.test.ts"],
    environment: "node",
    coverage: {
      include: [
        "extension-*/src/**/*.{ts,mjs}",
        "lib/**/*.ts",
        "onefile-cli/src/**/*.ts",
        "x-archive-{core,cli}/src/**/*.ts",
        "scripts/**/*.{ts,mjs}",
      ],
      exclude: ["**/test/**", "**/*.test.ts", "**/*.d.ts"],
      reporter: ["text", "json-summary"],
      reportsDirectory: ".work/coverage",
    },
  },
});
