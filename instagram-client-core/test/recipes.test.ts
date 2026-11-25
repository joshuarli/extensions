import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GRAPHQL_PATH, INSTAGRAM_OPERATIONS, RECIPE_FILES } from "../src/operations.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FIELDS = [
  "operation", "semantic_name", "description", "method", "path",
  "caller_inputs", "response_dependencies", "captured_config", "session_material",
  "app_generated", "observation_recipe", "verification_cases", "fixtures",
] as const;

describe("operation recipes", () => {
  it("covers every client operation with a complete recipe", () => {
    expect(Object.keys(RECIPE_FILES).sort()).toEqual([...INSTAGRAM_OPERATIONS].sort());
    for (const operation of INSTAGRAM_OPERATIONS) {
      const raw = readFileSync(ROOT + RECIPE_FILES[operation], "utf8");
      const recipe: unknown = JSON.parse(raw);
      expect(recipe).not.toBeNull();
      expect(typeof recipe).toBe("object");
      const record = recipe as Record<string, unknown>;
      expect(record["operation"]).toBe(operation);
      for (const field of FIELDS) expect(record[field]).toBeDefined();
    }
  });

  it("documents the GraphQL path the client requests", () => {
    const raw = readFileSync(ROOT + RECIPE_FILES["profile.posts"], "utf8");
    const recipe = JSON.parse(raw) as Record<string, unknown>;
    expect(recipe["path"]).toBe(GRAPHQL_PATH);
    expect(recipe["method"]).toBe("POST");
  });
});
