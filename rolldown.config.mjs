import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig } from "rolldown";

const repositoryRoot = resolve(import.meta.dirname, "."),
  isProductionBuild = process.env.NODE_ENV === "production",
  outputRoot = resolve(repositoryRoot, isProductionBuild ? "dist" : "build"),
  transformOptions = {
    define: { "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development") },
    target: "chrome150",
  };

function extensionPath(extensionName, ...pathSegments) {
  return resolve(repositoryRoot, extensionName, ...pathSegments);
}

function sourcePath(extensionName, ...pathSegments) {
  return extensionPath(extensionName, "src", ...pathSegments);
}

function outputDirectory(extensionName) {
  return resolve(outputRoot, extensionName);
}

function defineExtension(extensionName, options) {
  return {
    sourceDirectory: sourcePath(extensionName),
    outputDirectory: outputDirectory(extensionName),
    ...options,
  };
}

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

function outputOptions(extensionName, entryFileName, format, cleanDir) {
  return {
    cleanDir,
    dir: outputDirectory(extensionName),
    entryFileNames: entryFileName,
    format,
    minify: isProductionBuild,
    sourcemap: isProductionBuild ? false : "inline",
  };
}

function esmBundle(extensionName, input, entryFileName, cleanDir) {
  return defineConfig({
    input: sourcePath(extensionName, input),
    output: outputOptions(extensionName, entryFileName, "esm", cleanDir),
    transform: transformOptions,
  });
}

function classicBundle(extensionName, input, entryFileName) {
  return defineConfig({
    input: sourcePath(extensionName, input),
    output: outputOptions(extensionName, entryFileName, "iife", false),
    transform: transformOptions,
  });
}

const allowRightClickInjectedEntries = {
  "data/inject/core": "data/inject/core.ts",
  "data/inject/mouse": "data/inject/mouse.ts",
  "data/inject/styles": "data/inject/styles.ts",
  "data/inject/user-select/isolated": "data/inject/user-select/isolated.ts",
  "data/inject/user-select/main": "data/inject/user-select/main.ts",
  "data/inject/listen/isolated": "data/inject/listen/isolated.ts",
  "data/inject/listen/main": "data/inject/listen/main.ts",
};

export const extensionDefinitions = {
  "extension-loupe": defineExtension("extension-loupe", {
    generatedFiles: [
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
    bundleConfigs: [
      defineConfig({
        input: sourcePath("extension-loupe", "service-worker.ts"),
        plugins: [rawAssetPlugin],
        output: outputOptions("extension-loupe", "service-worker.js", "esm", true),
        transform: transformOptions,
      }),
      defineConfig({
        input: sourcePath("extension-loupe", "reader-content-script.ts"),
        plugins: [rawAssetPlugin],
        output: outputOptions("extension-loupe", "content.js", "iife", false),
        transform: transformOptions,
      }),
    ],
  }),
  "extension-allow-right-click": defineExtension("extension-allow-right-click", {
    bundleConfigs: [
      esmBundle("extension-allow-right-click", "service-worker.ts", "service-worker.js", true),
      ...Object.entries(allowRightClickInjectedEntries).map(([entryName, input]) =>
        classicBundle("extension-allow-right-click", input, `${entryName}.js`),
      ),
    ],
  }),
  "extension-youtube-transcript": defineExtension("extension-youtube-transcript", {
    inlineStylesheets: true,
    bundleConfigs: [
      defineConfig({
        input: {
          "service-worker": sourcePath("extension-youtube-transcript", "service-worker.ts"),
          options: sourcePath("extension-youtube-transcript", "options.ts"),
          popup: sourcePath("extension-youtube-transcript", "popup.ts"),
        },
        output: outputOptions("extension-youtube-transcript", "[name].js", "esm", true),
        transform: transformOptions,
      }),
    ],
  }),
};

export { outputRoot, repositoryRoot };
