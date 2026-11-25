import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["cli/test/**/*.test.ts", "extension-*/test/**/*.test.ts", "lib/test/**/*.test.ts", "chatgpt-archive-core/test/**/*.test.ts", "chatgpt-archive-cli/test/**/*.test.ts", "chatgpt-client-core/test/**/*.test.ts", "x-archive-core/test/**/*.test.ts", "x-archive-cli/test/**/*.test.ts", "x-discovery-core/test/**/*.test.ts", "x-discovery-cli/test/**/*.test.ts", "x-client-core/test/**/*.test.ts", "onefile-core/test/**/*.test.ts", "onefile-cli/test/**/*.test.ts", "youtube-transcript-core/test/**/*.test.ts", "youtube-transcript-cli/test/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["**/*.browser.test.ts"],
    environment: "node",
    coverage: {
      include: [
        "cli/src/**/*.ts",
        "extension-*/src/**/*.{ts,mjs}",
        "lib/**/*.ts",
        "chatgpt-archive-{core,cli}/src/**/*.ts",
        "chatgpt-client-core/src/**/*.ts",
        "onefile-{core,cli}/src/**/*.ts",
        "x-archive-{core,cli}/src/**/*.ts",
        "x-discovery-{core,cli}/src/**/*.ts",
        "x-client-core/src/**/*.ts",
        "youtube-transcript-{core,cli}/src/**/*.ts",
        "scripts/**/*.{ts,mjs}",
      ],
      exclude: ["**/test/**", "**/*.test.ts", "**/*.d.ts"],
      reporter: ["text", "json-summary"],
      reportsDirectory: ".work/coverage",
    },
  },
});
