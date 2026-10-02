import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { build } from "vite";
import { createExtensionBuildConfigs, extensionDefinitions } from "../vite.config.ts";

function copyStaticSource(sourceDirectory, outputDirectory) {
  cpSync(sourceDirectory, outputDirectory, {
    recursive: true,
    filter(sourcePath) {
      const relativePath = relative(sourceDirectory, sourcePath);
      if (relativePath === "") return true;
      return (
        relativePath !== "manifest.json" &&
        !/\.(?:ts|html|css)$/u.test(relativePath)
      );
    },
  });
}

function copyGeneratedFiles(extensionName, generatedFiles, outputDirectory) {
  for (const { source, destination } of generatedFiles ?? []) {
    if (!existsSync(source)) {
      throw new Error(
        `Generated file for ${extensionName} is missing at ${source}. Run deno task build:wasm first.`,
      );
    }
    cpSync(source, resolve(outputDirectory, destination));
  }
}

async function buildExtension(extensionName, extension, bundleConfigs) {
  for (const bundleConfig of bundleConfigs) {
    await build({ ...bundleConfig, configFile: false });
  }

  mkdirSync(extension.outputDirectory, { recursive: true });
  copyStaticSource(extension.sourceDirectory, extension.outputDirectory);

  const manifestPath = resolve(extension.sourceDirectory, "manifest.json"),
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  writeFileSync(
    resolve(extension.outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  copyGeneratedFiles(extensionName, extension.generatedFiles, extension.outputDirectory);
  console.log(`Built ${extensionName} in ${extension.outputDirectory}`);
}

const definitions = Object.entries(extensionDefinitions),
  configs = createExtensionBuildConfigs();
let configIndex = 0;
const definitionConfigs = new Map();

for (const [extensionName, extension] of definitions) {
  const bundleConfigs = configs.slice(configIndex, configIndex + extension.bundles.length);
  configIndex += extension.bundles.length;
  definitionConfigs.set(extensionName, bundleConfigs);
  await buildExtension(extensionName, extension, bundleConfigs);
}

if (process.argv.includes("--watch")) {
  const sourceDirectories = definitions.map(([, extension]) => extension.sourceDirectory),
    watcher = Deno.watchFs(sourceDirectories, { recursive: true });
  let pendingExtensions = new Set(),
    rebuildTimer,
    rebuildQueue = Promise.resolve();

  for await (const event of watcher) {
    for (const changedPath of event.paths) {
      const changedExtension = definitions.find(([, extension]) =>
        changedPath.startsWith(`${extension.sourceDirectory}/`)
      )?.[0];
      if (changedExtension) pendingExtensions.add(changedExtension);
    }
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      const extensionsToRebuild = [...pendingExtensions];
      pendingExtensions = new Set();
      rebuildQueue = rebuildQueue.then(async () => {
        for (const extensionName of extensionsToRebuild) {
          const extension = extensionDefinitions[extensionName];
          await buildExtension(
            extensionName,
            extension,
            definitionConfigs.get(extensionName),
          );
        }
      });
    }, 200);
  }
}
