import { resolve } from "node:path";
import { defineConfig, type UserConfig } from "vite";

const repositoryRoot = resolve(import.meta.dirname),
  isProductionBuild = process.env["NODE_ENV"] === "production",
  outputRoot = resolvePath(repositoryRoot, isProductionBuild ? "dist" : "build"),
  suiteOutputDirectory = resolvePath(outputRoot, "extension-suite"),
  suiteSourceDirectory = resolvePath(repositoryRoot, "extension-suite", "src");

export interface SuiteBundle {
  root: string;
  input: string | Record<string, string>;
  outputDirectory: string;
  entryFileName: string;
  format: "es" | "iife";
  target: string;
}

function resolvePath(...segments: string[]): string {
  return resolve(...segments);
}

function sourcePath(extensionName: string, ...segments: string[]): string {
  return resolvePath(repositoryRoot, extensionName, "src", ...segments);
}

function injectedBundles(
  extensionName: string,
  entries: readonly { source: string; output: string }[],
): SuiteBundle[] {
  return entries.map(({ source, output }) => ({
    root: sourcePath(extensionName),
    input: sourcePath(extensionName, source),
    outputDirectory: suiteOutputDirectory,
    entryFileName: `inject/${extensionName.replace(/^extension-/u, "")}/${output}.js`,
    format: "iife",
    target: "chrome120",
  }));
}

export const suiteBundles: SuiteBundle[] = [
  {
    root: suiteSourceDirectory,
    input: sourcePath("extension-suite", "service-worker.ts"),
    outputDirectory: suiteOutputDirectory,
    entryFileName: "service-worker.js",
    format: "es",
    target: "chrome120",
  },
  {
    root: suiteSourceDirectory,
    input: {
      popup: sourcePath("extension-suite", "popup.html"),
      options: sourcePath("extension-suite", "options.html"),
    },
    outputDirectory: suiteOutputDirectory,
    entryFileName: "[name].js",
    format: "es",
    target: "chrome120",
  },
  {
    root: sourcePath("extension-x-bookmarks"),
    input: sourcePath("extension-x-bookmarks", "options.html"),
    outputDirectory: resolvePath(suiteOutputDirectory, "features", "x-bookmarks"),
    entryFileName: "options.js",
    format: "es",
    target: "chrome120",
  },
  {
    root: sourcePath("extension-onefile"),
    input: sourcePath("extension-onefile", "offscreen.html"),
    outputDirectory: resolvePath(suiteOutputDirectory, "features", "onefile"),
    entryFileName: "offscreen.js",
    format: "es",
    target: "chrome120",
  },
  ...injectedBundles("extension-allow-right-click", [
    { source: "data/inject/core.ts", output: "core" },
    { source: "data/inject/mouse.ts", output: "mouse" },
    { source: "data/inject/styles.ts", output: "styles" },
    { source: "data/inject/user-select/isolated.ts", output: "user-select/isolated" },
    { source: "data/inject/user-select/main.ts", output: "user-select/main" },
    { source: "data/inject/listen/isolated.ts", output: "listen/isolated" },
    { source: "data/inject/listen/main.ts", output: "listen/main" },
  ]),
  ...injectedBundles("extension-onefile", [
    { source: "inject/capture.ts", output: "capture" },
    { source: "inject/loader.ts", output: "loader" },
  ]),
];

export { repositoryRoot, suiteOutputDirectory, suiteSourceDirectory };

export function createSuiteBuildConfigs(
  production = isProductionBuild,
): UserConfig[] {
  return suiteBundles.map((bundle) => ({
    mode: production ? "production" : "development",
    root: bundle.root,
    base: "./",
    define: {
      "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development"),
    },
    build: {
      outDir: bundle.outputDirectory,
      emptyOutDir: false,
      copyPublicDir: false,
      target: bundle.target,
      minify: production,
      sourcemap: production ? false : "inline",
      rolldownOptions: {
        input: bundle.input,
        output: {
          format: bundle.format,
          entryFileNames: bundle.entryFileName,
          chunkFileNames: "chunks/[name]-[hash].js",
          assetFileNames: "[name][extname]",
        },
      },
    },
  }));
}

export default defineConfig({
  server: { forwardConsole: true },
});
