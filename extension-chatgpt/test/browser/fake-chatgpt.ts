import type { BrowserContext, Route } from "playwright/test";

export interface FakeChat {
  id: string;
  title: string;
  createdMs: number;
  projectId: string | null;
  archived: boolean;
  visible: boolean;
  pinned: boolean;
  image: boolean;
}

export interface Patch {
  id: string;
  body: Record<string, unknown>;
  status: number;
}

export const PROJECTS = [
  { id: "g-p-work", name: "Work" },
  { id: "g-p-home", name: "Home" },
];

const DAY = 86_400_000;
const EPOCH = Date.UTC(2024, 0, 1);

// A routed stand-in for chatgpt.com's private backend, with switches for the failures
// the organizer must survive.
export class FakeChatgpt {
  readonly chats = new Map<string, FakeChat>();
  readonly patches: Patch[] = [];
  accountId = "u-e2e";
  // Apply the next PATCH to these chats, then answer 500 as if the response was lost.
  readonly loseResponseFor = new Set<string>();
  // Answer the next N PATCHes with 429 and Retry-After: 1, without applying them.
  rateLimitPatches = 0;

  constructor(chats: Partial<FakeChat>[]) {
    chats.forEach((chat, index) => {
      const id = chat.id ?? `c${index + 1}`;
      this.chats.set(id, {
        id,
        title: chat.title ?? `Chat ${index + 1}`,
        createdMs: chat.createdMs ?? EPOCH + index * DAY,
        projectId: chat.projectId ?? null,
        archived: chat.archived ?? false,
        visible: chat.visible ?? true,
        pinned: chat.pinned ?? false,
        image: chat.image ?? false,
      });
    });
  }

  static generated(count: number): FakeChatgpt {
    return new FakeChatgpt(Array.from({ length: count }, (_, index) => ({
      title: `Generated chat ${index + 1}`,
      projectId: index % 7 === 0 ? PROJECTS[index % 2]?.id ?? null : null,
      archived: index % 11 === 0,
      pinned: index % 13 === 0,
    })));
  }

  applied(id: string): FakeChat | undefined {
    return this.chats.get(id);
  }

  private row(chat: FakeChat): Record<string, unknown> {
    const iso = new Date(chat.createdMs).toISOString();
    return {
      id: chat.id,
      title: chat.title,
      create_time: iso,
      update_time: iso,
      conversation_template_id: chat.projectId,
      gizmo_id: chat.projectId,
      is_archived: chat.archived,
      pinned_time: chat.pinned ? iso : null,
      is_starred: null,
    };
  }

  private detail(chat: FakeChat): Record<string, unknown> {
    const iso = new Date(chat.createdMs).toISOString();
    const parts: unknown[] = chat.image ? [{ content_type: "image_asset_pointer", asset_pointer: "file-service://img" }, `About ${chat.title}`] : [`About ${chat.title}`];
    return {
      title: chat.title,
      create_time: iso,
      update_time: iso,
      is_archived: chat.archived,
      gizmo_id: chat.projectId,
      conversation_template_id: chat.projectId,
      current_node: "a1",
      mapping: {
        root: { id: "root", parent: null, children: ["u1"], message: null },
        u1: {
          id: "u1", parent: "root", children: ["a1"],
          message: { author: { role: "user" }, create_time: iso, content: { content_type: chat.image ? "multimodal_text" : "text", parts }, metadata: {} },
        },
        a1: {
          id: "a1", parent: "u1", children: [],
          message: { author: { role: "assistant" }, create_time: iso, content: { content_type: "text", parts: [`Notes on ${chat.title}.`] }, metadata: {} },
        },
      },
    };
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route("https://chatgpt.com/**", (route) => this.handle(route));
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
      headers,
    });
    if (url.pathname === "/api/auth/session") {
      return json(200, { user: { id: this.accountId, name: "Fixture" }, accessToken: `token-${this.accountId}`, expires: "2030-01-01T00:00:00Z" });
    }
    if (url.pathname === "/backend-api/conversations") {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 100);
      const archived = url.searchParams.get("is_archived") === "true";
      const rows = [...this.chats.values()]
        .filter((chat) => chat.visible && chat.archived === archived)
        .sort((a, b) => b.createdMs - a.createdMs);
      return json(200, { items: rows.slice(offset, offset + limit).map((chat) => this.row(chat)), total: rows.length, limit, offset, has_missing_conversations: false });
    }
    if (url.pathname === "/backend-api/gizmos/snorlax/sidebar") {
      return json(200, {
        items: PROJECTS.map((project) => ({ gizmo: { gizmo: { id: project.id, gizmo_type: "snorlax", display: { name: project.name } } }, conversations: { items: [] } })),
        cursor: null,
      });
    }
    if (url.pathname.startsWith("/backend-api/conversation/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      const chat = this.chats.get(id);
      if (!chat || !chat.visible) return json(404, { detail: "conversation_not_found" });
      if (request.method() === "PATCH") {
        const body = request.postDataJSON() as Record<string, unknown>;
        if (this.rateLimitPatches > 0) {
          this.rateLimitPatches -= 1;
          this.patches.push({ id, body, status: 429 });
          return json(429, { detail: "Too many requests" }, { "retry-after": "1" });
        }
        if (typeof body["is_visible"] === "boolean") chat.visible = body["is_visible"];
        if (typeof body["is_archived"] === "boolean") chat.archived = body["is_archived"];
        if (typeof body["title"] === "string") chat.title = body["title"];
        if (typeof body["gizmo_id"] === "string") chat.projectId = body["gizmo_id"] || null;
        if (this.loseResponseFor.delete(id)) {
          this.patches.push({ id, body, status: 500 });
          return json(500, { detail: "upstream timeout" });
        }
        this.patches.push({ id, body, status: 200 });
        return json(200, { success: true });
      }
      return json(200, this.detail(chat));
    }
    return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>ChatGPT fixture</title><main>fixture</main>" });
  }
}
