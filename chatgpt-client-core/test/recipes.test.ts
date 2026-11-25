import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createChatgptArchive } from "../../chatgpt-archive-core/src/index.ts";
import { CHATGPT_OPERATIONS, RECIPE_FILES, type ChatgptOperation } from "../src/operations.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FIELDS = [
  "operation", "semantic_name", "description", "method", "path",
  "caller_inputs", "response_dependencies", "captured_config", "session_material",
  "app_generated", "observation_recipe", "verification_cases", "fixtures",
] as const;

function readRecipe(operation: ChatgptOperation): Record<string, unknown> {
  const path = RECIPE_FILES[operation];
  const raw = readFileSync(ROOT + path, "utf8");
  const value: unknown = JSON.parse(raw);
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  return value as Record<string, unknown>;
}

async function observedPaths(): Promise<string[]> {
  const paths: string[] = [];
  const archive = createChatgptArchive({
    transport: {
      async getJson(path) {
        paths.push(path);
        if (path === "/api/auth/session") return { user: { id: "acct" }, accessToken: "tok" };
        if (path.includes("/backend-api/conversation/")) return { mapping: {} };
        return { items: [], total: 0 };
      },
      async getBytes(path) {
        paths.push(path);
        return new Uint8Array();
      },
    },
    sleep: async () => {},
    now: () => 0,
  });
  await archive.session();
  await archive.list("active");
  await archive.list("archived");
  await archive.record("abc");
  await archive.getMediaBytes("/backend-api/files/file-1/download");
  return paths;
}

describe("operation recipes", () => {
  it("covers every client operation with a complete recipe", () => {
    expect(Object.keys(RECIPE_FILES).sort()).toEqual([...CHATGPT_OPERATIONS].sort());
    for (const operation of CHATGPT_OPERATIONS) {
      const recipe = readRecipe(operation);
      expect(recipe["operation"]).toBe(operation);
      expect(recipe["method"]).toBe("GET");
      for (const field of FIELDS) expect(recipe[field]).toBeDefined();
      for (const field of ["caller_inputs", "response_dependencies", "captured_config", "session_material",
        "app_generated", "observation_recipe", "verification_cases", "fixtures"] as const) {
        expect(Array.isArray(recipe[field])).toBe(true);
      }
    }
  });

  it("documents the paths the archive actually requests", async () => {
    const paths = await observedPaths();
    const session = readRecipe("session")["path"];
    const list = String(readRecipe("conversations.list")["path"])
      .replace("{offset}", "0")
      .replace("{limit}", "100");
    const record = String(readRecipe("conversation.get")["path"]).replace("{id}", "abc");
    const media = String(readRecipe("files.download")["path"]).replace("{id}", "file-1");

    expect(session).toBe("/api/auth/session");
    expect(paths).toEqual(expect.arrayContaining([
      session,
      list,
      list + "&is_archived=true",
      record,
      media,
    ]));
  });
});
