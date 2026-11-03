import { cpSync, mkdirSync, readdirSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { build } from "vite";
import {
  createSuiteBuildConfigs,
  repositoryRoot,
  suiteOutputDirectory,
  suiteSourceDirectory,
} from "../vite.config.ts";
import { manifest } from "../extension-suite/src/manifest.ts";
import { createRebuildQueue } from "./rebuild-queue.ts";

function copyStaticSource(sourceDirectory, outputDirectory) {
  cpSync(sourceDirectory, outputDirectory, {
    recursive: true,
    filter(sourcePath) {
      const relativePath = relative(sourceDirectory, sourcePath);
      if (relativePath === "") return true;
      return !/(?:^|\/)(?:manifest\.ts|.*\.(?:ts|html|css))$/u.test(relativePath);
    },
  });
}

async function buildSuite() {
  rmSync(suiteOutputDirectory, { recursive: true, force: true });
  mkdirSync(suiteOutputDirectory, { recursive: true });

  for (const bundleConfig of createSuiteBuildConfigs()) {
    await build({ ...bundleConfig, configFile: false });
  }

  copyStaticSource(suiteSourceDirectory, suiteOutputDirectory);
  mkdirSync(resolve(suiteOutputDirectory, "rules"), { recursive: true });
  cpSync(
    resolve(repositoryRoot, "extension-youtube-transcript", "src", "rules.json"),
    resolve(suiteOutputDirectory, "rules", "youtube-headers.json"),
  );
  writeFileSync(
    resolve(suiteOutputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log(`Built extension-suite in ${suiteOutputDirectory}`);
}

await buildSuite();

if (process.argv.includes("--watch")) {
  const sourceDirectories = [
    suiteSourceDirectory,
    resolve(repositoryRoot, "lib"),
    ...readdirSync(repositoryRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^extension-(?!suite$)/u.test(entry.name))
      .map((entry) => resolve(repositoryRoot, entry.name, "src")),
  ];
  const enqueueRebuild = createRebuildQueue((error) => {
    console.error("Failed to rebuild extension-suite:", error);
  });
  let rebuildTimer;

  function scheduleRebuild() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      enqueueRebuild(buildSuite);
    }, 200);
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
      scheduleRebuild();
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
