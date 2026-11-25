import { Schema } from "effect";
import type { ProjectConfig } from "./project.ts";
import { projectVersion } from "./project.ts";
import type { DiscoveredPost } from "./post.ts";

export const ResourceLinkSchema = Schema.Struct({
  url: Schema.String,
  host: Schema.String,
  dedupe_key: Schema.String,
  source_tweet_id: Schema.String,
  association: Schema.Literals(["entity", "text"]),
  display_url: Schema.String,
});

export type ResourceLink = Schema.Schema.Type<typeof ResourceLinkSchema>;

export interface LinkCheck {
  dedupe_key: string;
  status: number | null;
  accessible: boolean;
  checked_at: string;
}

function isResourceHost(host: string, project: ProjectConfig): boolean {
  return project.resource_hosts.some((candidate) => host === candidate || host.endsWith("." + candidate));
}

export function extractResourceLinks(post: DiscoveredPost, project: ProjectConfig): ResourceLink[] {
  const fromEntity = post.urls.map((link) => ({ candidate: link.url, association: "entity" as const, display: link.display_url }));
  const fromText = (post.full_text.match(/https?:\/\/[^\s<>"']+/gu) ?? [])
    .map((candidate) => ({ candidate, association: "text" as const, display: candidate }));
  const seen = new Set<string>();
  const result: ResourceLink[] = [];
  for (const { candidate, association, display } of [...fromEntity, ...fromText]) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
    const host = parsed.hostname.replace(/^www\./u, "").toLowerCase();
    if (!isResourceHost(host, project)) continue;
    const query = [...parsed.searchParams.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => encodeURIComponent(key) + "=" + encodeURIComponent(value))
      .join("&");
    const dedupeKey = parsed.origin + parsed.pathname + "?" + query + (parsed.hash ? "#" + parsed.hash : "");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push({ url: parsed.toString(), host, dedupe_key: dedupeKey, source_tweet_id: post.tweet_id, association, display_url: display });
  }
  return result;
}

export function linkVersion(project: ProjectConfig): string {
  return projectVersion(project);
}

export async function checkLinks(
  links: readonly ResourceLink[],
  budget: number = 3,
  timeoutMs: number = 8_000,
): Promise<LinkCheck[]> {
  const results: LinkCheck[] = [];
  for (const link of links.slice(0, budget)) {
    let status: number | null = null;
    try {
      const response = await fetch(link.url, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
      status = response.status;
    } catch {
      status = null;
    }
    results.push({
      dedupe_key: link.dedupe_key,
      status,
      accessible: status !== null && status < 400,
      checked_at: new Date().toISOString(),
    });
  }
  return results;
}
