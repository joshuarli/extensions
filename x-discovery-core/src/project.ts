import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";

export const ProjectConfigSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  description: Schema.String,
  topic_terms: Schema.Array(Schema.Tuple([Schema.String, Schema.Number])),
  relevance_threshold: Schema.Number,
  resource_hosts: Schema.Array(Schema.String),
  ledger_path: Schema.String,
});

export type ProjectConfig = Schema.Schema.Type<typeof ProjectConfigSchema>;

export function projectVersion(config: ProjectConfig): string {
  return config.id + "-" + createHash("sha256")
    .update(JSON.stringify([config.topic_terms, config.relevance_threshold, config.resource_hosts]))
    .digest("hex").slice(0, 8);
}

export function projectsDirectory(): string {
  return new URL("../projects/", import.meta.url).pathname;
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
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return Schema.decodeUnknownSync(ProjectConfigSchema)(parsed);
}
