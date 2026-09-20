import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig } from "rolldown";

const repositoryRoot = resolve(import.meta.dirname, "."),
  isProductionBuild = process.env.NODE_ENV === "production",
  transformOptions = {
    define: { "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development") },
    target: "chrome150",
  };

export const rawAssetPlugin = {
  name: "raw-asset-imports",
  resolveId(source, importer) {
    if (!importer || !source.endsWith("?raw")) {
      return null;
    }
    return resolve(dirname(importer), source.slice(0, -"?raw".length));
  },
  load(id) {
    if (!id.endsWith(".css") && !id.endsWith(".html")) {
      return null;
    }
    return {
      code: `export default ${JSON.stringify(readFileSync(id, "utf8"))};`,
      moduleType: "js",
    };
  },
};

function outputOptions(extensionDirectory, entryFileName, format, cleanDir) {
  return {
    cleanDir,
    dir: resolve(repositoryRoot, extensionDirectory, isProductionBuild ? "dist" : "build"),
    entryFileNames: entryFileName,
    format,
    minify: isProductionBuild,
    sourcemap: isProductionBuild ? false : "inline",
  };
}

function esmBundle(extensionDirectory, input, entryFileName, cleanDir) {
  return defineConfig({
    input: resolve(repositoryRoot, extensionDirectory, input),
    output: outputOptions(extensionDirectory, entryFileName, "esm", cleanDir),
    transform: transformOptions,
  });
}

function classicBundle(extensionDirectory, input, entryFileName) {
  return defineConfig({
    input: resolve(repositoryRoot, extensionDirectory, input),
    output: outputOptions(extensionDirectory, entryFileName, "iife", false),
    transform: transformOptions,
  });
}

const allowRightClickInjectedEntries = {
  "data/inject/core": "src/data/inject/core.ts",
  "data/inject/mouse": "src/data/inject/mouse.ts",
  "data/inject/styles": "src/data/inject/styles.ts",
  "data/inject/user-select/isolated": "src/data/inject/user-select/isolated.ts",
  "data/inject/user-select/main": "src/data/inject/user-select/main.ts",
  "data/inject/listen/isolated": "src/data/inject/listen/isolated.ts",
  "data/inject/listen/main": "src/data/inject/listen/main.ts",
};

export const extensionDefinitions = {
  "extension-loupe": {
    sourceDirectory: resolve(repositoryRoot, "extension-loupe/src"),
    outputDirectory: resolve(
      repositoryRoot,
      "extension-loupe",
      isProductionBuild ? "dist" : "build",
    ),
    generatedWasmPath: resolve(
      repositoryRoot,
      "extension-loupe/.generated/defuddle-wasm/defuddle_wasm_bg.wasm",
    ),
    bundleConfigs: [
      defineConfig({
        input: resolve(repositoryRoot, "extension-loupe/src/service-worker.ts"),
        plugins: [rawAssetPlugin],
        output: outputOptions("extension-loupe", "service-worker.js", "esm", true),
        transform: transformOptions,
      }),
      defineConfig({
        input: resolve(repositoryRoot, "extension-loupe/src/reader-content-script.ts"),
        plugins: [rawAssetPlugin],
        output: outputOptions("extension-loupe", "content.js", "iife", false),
        transform: transformOptions,
      }),
    ],
  },
  "extension-allow-right-click": {
    sourceDirectory: resolve(repositoryRoot, "extension-allow-right-click/src"),
    outputDirectory: resolve(
      repositoryRoot,
      "extension-allow-right-click",
      isProductionBuild ? "dist" : "build",
    ),
    bundleConfigs: [
      esmBundle("extension-allow-right-click", "src/service-worker.ts", "service-worker.js", true),
      ...Object.entries(allowRightClickInjectedEntries).map(([entryName, input]) =>
        classicBundle("extension-allow-right-click", input, `${entryName}.js`),
      ),
    ],
  },
  "extension-youtube-transcript": {
    sourceDirectory: resolve(repositoryRoot, "extension-youtube-transcript/src"),
    outputDirectory: resolve(
      repositoryRoot,
      "extension-youtube-transcript",
      isProductionBuild ? "dist" : "build",
    ),
    inlineStylesheets: true,
    bundleConfigs: [
      defineConfig({
        input: {
          "service-worker": resolve(
            repositoryRoot,
            "extension-youtube-transcript/src/service-worker.ts",
          ),
          options: resolve(repositoryRoot, "extension-youtube-transcript/src/options.ts"),
          popup: resolve(repositoryRoot, "extension-youtube-transcript/src/popup.ts"),
        },
        output: {
          cleanDir: true,
          dir: resolve(
            repositoryRoot,
            "extension-youtube-transcript",
            isProductionBuild ? "dist" : "build",
          ),
          entryFileNames: "[name].js",
          format: "esm",
          minify: isProductionBuild,
          sourcemap: isProductionBuild ? false : "inline",
        },
        transform: transformOptions,
      }),
    ],
  },
};

export { repositoryRoot };
