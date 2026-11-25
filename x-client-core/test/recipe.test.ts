import { describe, expect, it } from "vitest";
import { deriveRecipe, type Observation } from "../src/recipe.ts";

function observation(label: string, values: Record<string, unknown>, responseKeys: string[] = []): Observation {
  return {
    label,
    method: "POST",
    path: "/i/api/graphql/abc/HomeTimeline",
    values,
    responseKeys,
    headers: { authorization: "Bearer <redacted>", "x-csrf-token": "<redacted>", "x-client-transaction-id": "<redacted>" },
  };
}

describe("deriveRecipe", () => {
  it("classifies caller inputs, response dependencies and captured config across observations", () => {
    const recipe = deriveRecipe("HomeTimeline", "home.page", [
      observation("initial", { count: 20, variables: { count: 20 }, features: { a: true } }, ["variables"]),
      observation("changed input", { count: 30, variables: { count: 30 }, features: { a: true } }, ["variables"]),
      observation("continuation", { count: 20, cursor: "next", features: { a: true } }, ["variables"]),
      observation("fresh run", { count: 20, features: { b: false } }, ["variables"]),
    ]);
    expect(recipe.method).toBe("POST");
    expect(recipe.caller_inputs).toContain("count");
    expect(recipe.response_dependencies).toContain("cursor");
    expect(recipe.captured_config).toContain("features");
    expect(recipe.session_material).toEqual(["authorization", "x-client-transaction-id", "x-csrf-token"]);
    expect(recipe.verification_cases.length).toBeGreaterThan(4);
  });

  it("flags a per-request signed value as application-generated", () => {
    const recipe = deriveRecipe("HomeTimeline", "home.page", [
      observation("initial", { sig: "a".repeat(32) }),
      observation("fresh run", { sig: "b".repeat(32) }),
    ]);
    expect(recipe.app_generated).toContain("sig");
  });
});
