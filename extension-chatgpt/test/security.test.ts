import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chatgptManifest } from "../src/manifest.fragment.ts";

const sourceDirectory = fileURLToPath(new URL("../src", import.meta.url));

function typescriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...typescriptFiles(path));
    else if (entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

describe("security boundary", () => {
  it("asks for storage only and restricts host access to chatgpt.com", () => {
    expect([...chatgptManifest.permissions].sort()).toEqual(["storage"]);
    expect(chatgptManifest.host_permissions).toEqual(["https://chatgpt.com/*"]);
  });

  it("does not request privileged APIs, broad host access or remote code", () => {
    const serialized = JSON.stringify(chatgptManifest);
    for (const forbidden of ["cookies", "webRequest", "debugger", "<all_urls>", "externally_connectable"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(chatgptManifest.content_security_policy?.extension_pages).toBe("script-src 'self'; object-src 'self'");
  });

  it("makes no third-party network requests in source", () => {
    const xmlNamespaces = new Set(["http://www.w3.org/2000/svg"]);
    for (const file of typescriptFiles(sourceDirectory)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/https?:\/\/[^\s"'`)${}]+/gu)) {
        if (xmlNamespaces.has(match[0])) continue;
        expect(match[0], `${file}: ${match[0]}`).toMatch(/^https:\/\/chatgpt\.com(?:\/|$)/u);
      }
    }
  });
});
