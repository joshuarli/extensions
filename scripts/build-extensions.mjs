import { build } from "rolldown";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { extensionDefinitions } from "../rolldown.config.mjs";

function copyStaticSource(sourceDirectory, outputDirectory) {
  cpSync(sourceDirectory, outputDirectory, {
    recursive: true,
    filter(sourcePath) {
      const relativePath = relative(sourceDirectory, sourcePath);
      return (
        relativePath === "" || (relativePath !== "manifest.json" && !relativePath.endsWith(".ts"))
      );
    },
  });
}

function inlineStylesheets(outputDirectory, sourceDirectory) {
  for (const filename of readdirSync(outputDirectory)) {
    if (!filename.endsWith(".html")) {
      continue;
    }
    const outputPath = resolve(outputDirectory, filename);
    let html = readFileSync(outputPath, "utf8");
    html = html.replaceAll(/<link rel="stylesheet" href="(.+?)"\s*\/?>/gu, (_match, href) => {
      const stylesheet = readFileSync(resolve(sourceDirectory, href), "utf8");
      return `<style>\n${stylesheet.trim()}\n</style>`;
    });
    writeFileSync(outputPath, html);
  }
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

async function buildExtension(extensionName, extension) {
  for (const bundleConfig of extension.bundleConfigs) {
    // eslint-disable-next-line no-await-in-loop
    await build(bundleConfig);
  }

  mkdirSync(extension.outputDirectory, { recursive: true });
  copyStaticSource(extension.sourceDirectory, extension.outputDirectory);
  if (extension.inlineStylesheets) {
    inlineStylesheets(extension.outputDirectory, extension.sourceDirectory);
  }

  const manifestPath = resolve(extension.sourceDirectory, "manifest.json"),
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  writeFileSync(
    resolve(extension.outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  copyGeneratedFiles(extensionName, extension.generatedFiles, extension.outputDirectory);

  console.log(`Built ${extensionName} in ${extension.outputDirectory}`);
}

for (const [extensionName, extension] of Object.entries(extensionDefinitions)) {
  await buildExtension(extensionName, extension);
}
