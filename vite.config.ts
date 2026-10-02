import { basename, dirname, resolve } from "node:path";
import { defineConfig, type UserConfig } from "vite";

const repositoryRoot = resolve(import.meta.dirname),
  isProductionBuild = process.env["NODE_ENV"] === "production",
  outputRoot = resolvePath(repositoryRoot, isProductionBuild ? "dist" : "build");

interface ExtensionBundle {
  input: string | Record<string, string>;
  entryFileName: string;
  format: "es" | "iife";
  target: string;
  emptyOutDir: boolean;
}

interface GeneratedFile {
  source: string;
  destination: string;
}

interface ExtensionDefinition {
  sourceDirectory: string;
  outputDirectory: string;
  bundles: ExtensionBundle[];
  generatedFiles?: GeneratedFile[];
}

function resolvePath(...segments: string[]): string {
  return resolve(...segments);
}

function extensionPath(extensionName: string, ...segments: string[]): string {
  return resolvePath(repositoryRoot, extensionName, ...segments);
}

function sourcePath(extensionName: string, ...segments: string[]): string {
  return extensionPath(extensionName, "src", ...segments);
}

function defineExtension(
  extensionName: string,
  bundles: ExtensionBundle[],
  generatedFiles?: GeneratedFile[],
): ExtensionDefinition {
  return {
    sourceDirectory: sourcePath(extensionName),
    outputDirectory: resolvePath(outputRoot, extensionName),
    bundles,
    ...(generatedFiles ? { generatedFiles } : {}),
  };
}

const allowRightClickInjectedEntries = [
    "data/inject/core.ts",
    "data/inject/mouse.ts",
    "data/inject/styles.ts",
    "data/inject/user-select/isolated.ts",
    "data/inject/user-select/main.ts",
    "data/inject/listen/isolated.ts",
    "data/inject/listen/main.ts",
  ],
  extensionDefinitions: Record<string, ExtensionDefinition> = {
    "extension-loupe": defineExtension(
      "extension-loupe",
      [
        {
          input: sourcePath("extension-loupe", "service-worker.ts"),
          entryFileName: "service-worker.js",
          format: "es",
          target: "chrome150",
          emptyOutDir: true,
        },
        {
          input: sourcePath("extension-loupe", "reader-content-script.ts"),
          entryFileName: "content.js",
          format: "iife",
          target: "chrome150",
          emptyOutDir: false,
        },
      ],
      [
        {
          source: extensionPath(
            "extension-loupe",
            ".generated",
            "defuddle-wasm",
            "defuddle_wasm_bg.wasm",
          ),
          destination: "defuddle_wasm_bg.wasm",
        },
      ],
    ),
    "extension-allow-right-click": defineExtension("extension-allow-right-click", [
      {
        input: sourcePath("extension-allow-right-click", "service-worker.ts"),
        entryFileName: "service-worker.js",
        format: "es",
        target: "chrome110",
        emptyOutDir: true,
      },
      ...allowRightClickInjectedEntries.map((entry) => ({
        input: sourcePath("extension-allow-right-click", entry),
        entryFileName: `${entry.replace(/\.ts$/u, "")}.js`,
        format: "iife" as const,
        target: "chrome110",
        emptyOutDir: false,
      })),
    ]),
    "extension-youtube-transcript": defineExtension("extension-youtube-transcript", [
      {
        input: {
          "service-worker": sourcePath("extension-youtube-transcript", "service-worker.ts"),
          popup: sourcePath("extension-youtube-transcript", "popup.html"),
          options: sourcePath("extension-youtube-transcript", "options.html"),
        },
        entryFileName: "[name].js",
        format: "es",
        target: "chrome110",
        emptyOutDir: true,
      },
    ]),
  };

export const outputRootPath = outputRoot;
export { extensionDefinitions, repositoryRoot };

export function createExtensionBuildConfigs(
  production = isProductionBuild,
): UserConfig[] {
  const configs: UserConfig[] = [];

  for (const extension of Object.values(extensionDefinitions)) {
    for (const bundle of extension.bundles) {
      configs.push({
        root: extension.sourceDirectory,
        base: "./",
        define: {
          "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development"),
        },
        build: {
          outDir: extension.outputDirectory,
          emptyOutDir: bundle.emptyOutDir,
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
      });
    }
  }

  return configs;
}

export function createSingleFileBundleConfig(
  input: string,
  outputFile: string,
  target = "chrome150",
): UserConfig {
  return {
    root: repositoryRoot,
    base: "./",
    define: { "process.env.NODE_ENV": JSON.stringify("test") },
    build: {
      outDir: dirname(outputFile),
      emptyOutDir: false,
      copyPublicDir: false,
      minify: false,
      sourcemap: false,
      target,
      rolldownOptions: {
        input,
        output: {
          format: "iife",
          entryFileNames: basename(outputFile),
        },
      },
    },
  };
}

export default defineConfig({
  server: { forwardConsole: true },
});
