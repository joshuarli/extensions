import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { UsageError } from "../../lib/cli.ts";

export const ProjectConfigSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  description: Schema.String,
  topic_terms: Schema.Array(Schema.Tuple([Schema.String, Schema.Number])),
  negative_terms: Schema.optional(Schema.Array(Schema.Tuple([Schema.String, Schema.Number]))),
  relevance_threshold: Schema.Number,
  resource_hosts: Schema.Array(Schema.String),
  ledger_path: Schema.String,
});

export type ProjectConfig = Schema.Schema.Type<typeof ProjectConfigSchema>;

export function projectVersion(config: ProjectConfig): string {
  return config.id + "-" + createHash("sha256")
    .update(JSON.stringify([config.topic_terms, config.negative_terms ?? [], config.relevance_threshold, config.resource_hosts]))
    .digest("hex").slice(0, 8);
}

export function projectsDirectory(): string {
  return fileURLToPath(new URL("../projects/", import.meta.url));
}

export function listProjects(): string[] {
  return readdirSync(projectsDirectory())
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -5))
    .sort();
}

export function loadProject(id: string): ProjectConfig {
  if (!/^[a-z0-9-]+$/u.test(id)) throw new Error("Invalid project id \"" + id + "\".");
  const path = join(projectsDirectory(), id + ".json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new UsageError("Could not read project \"" + id + "\" at " + path + ": "
      + (error instanceof Error ? error.message : String(error)));
  }
  try {
    const config = Schema.decodeUnknownSync(ProjectConfigSchema)(parsed);
    if (!Number.isFinite(config.relevance_threshold) || config.relevance_threshold < 0) {
      throw new Error("relevance_threshold must be a non-negative number.");
    }
    for (const [term, weight] of [...config.topic_terms, ...(config.negative_terms ?? [])]) {
      if (term.trim() === "" || !Number.isFinite(weight) || weight < 0) {
        throw new Error("Every topic term needs a name and a non-negative weight.");
      }
    }
    return config;
  } catch (error) {
    throw new UsageError("Invalid project \"" + id + "\" at " + path + ": "
      + (error instanceof Error ? error.message : String(error)));
  }
}
