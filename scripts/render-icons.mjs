import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright";

const repositoryRoot = resolve(import.meta.dirname, ".."),
  iconSizes = [16, 32, 48, 128];

function findIconSources(directory) {
  const sources = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^extension-/u.test(entry.name)) continue;
    const sourceDirectory = join(directory, entry.name, "src");
    for (const candidate of findIconFiles(sourceDirectory)) {
      sources.push(candidate);
    }
  }
  return sources;
}

function findIconFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...findIconFiles(entryPath));
    } else if (entry.name === "icon.svg") {
      files.push(entryPath);
    }
  }
  return files;
}

const browser = await chromium.launch(),
  page = await browser.newPage({ deviceScaleFactor: 1 });

for (const sourcePath of findIconSources(repositoryRoot)) {
  const svg = readFileSync(sourcePath, "utf8"),
    outputDirectory = dirname(sourcePath);
  for (const size of iconSizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    writeFileSync(
      join(outputDirectory, `${size}.png`),
      await page.screenshot({ omitBackground: true }),
    );
  }
  console.log(`Rendered ${sourcePath}`);
}

await browser.close();
