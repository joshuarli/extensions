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

for (const [extensionName, extension] of Object.entries(extensionDefinitions)) {
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

  if (extension.generatedWasmPath) {
    if (!existsSync(extension.generatedWasmPath)) {
      throw new Error(
        `Loupe WASM bindings are missing at ${extension.generatedWasmPath}. Run deno task build:wasm first.`,
      );
    }
    cpSync(
      extension.generatedWasmPath,
      resolve(extension.outputDirectory, "defuddle_wasm_bg.wasm"),
    );
  }

  console.log(`Built ${extensionName} in ${extension.outputDirectory}`);
}
