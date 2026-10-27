import { cpSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { build } from "vite";
import { createExtensionBuildConfigs, extensionDefinitions } from "../vite.config.ts";
import { createRebuildQueue } from "./rebuild-queue.ts";

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
  const sourceDirectories = definitions.map(([, extension]) => extension.sourceDirectory);
  let pendingExtensions = new Set(),
    rebuildTimer;
  const enqueueRebuild = createRebuildQueue((error) => {
    console.error("Failed to rebuild extensions:", error);
  });

  function findExtension(changedPath) {
    return definitions.find(([, extension]) =>
      changedPath === extension.sourceDirectory ||
      changedPath.startsWith(`${extension.sourceDirectory}/`)
    )?.[0];
  }

  function scheduleRebuild() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      const extensionsToRebuild = [...pendingExtensions];
      pendingExtensions = new Set();
      enqueueRebuild(async () => {
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

  function handleChangedPath(changedPath) {
    const changedExtension = findExtension(changedPath);
    if (changedExtension) {
      pendingExtensions.add(changedExtension);
      scheduleRebuild();
    }
  }

  function collectDirectories(root) {
    const directories = [root],
      stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const full = resolve(current, entry.name);
          directories.push(full);
          stack.push(full);
        }
      }
    }
    return directories;
  }

  const watched = new Set();
  function watchDirectory(directory) {
    if (watched.has(directory)) return;
    watched.add(directory);
    const watcher = watch(directory, (eventType, filename) => {
      const changedPath = filename ? resolve(directory, filename) : directory;
      const created = statSync(changedPath, { throwIfNoEntry: false });
      if (created?.isDirectory()) {
        for (const subdirectory of collectDirectories(changedPath)) {
          watchDirectory(subdirectory);
        }
      }
      handleChangedPath(changedPath);
    });
    watcher.on("error", (error) => {
      console.error(`Failed to watch ${directory}:`, error);
    });
  }

  for (const sourceDirectory of sourceDirectories) {
    for (const directory of collectDirectories(sourceDirectory)) {
      watchDirectory(directory);
    }
  }
}
