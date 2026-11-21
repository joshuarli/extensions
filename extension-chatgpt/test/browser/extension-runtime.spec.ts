import { expect, test, chromium, type BrowserContext } from "playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";

const extensionPath = resolve("build/extension-chatgpt");

const conversations = {
  items: [
    {
      id: "c1",
      title: "Sourdough starter",
      create_time: "2024-01-01T00:00:00Z",
      update_time: "2024-01-01T00:00:00Z",
      conversation_template_id: null,
      gizmo_id: null,
      is_archived: false,
      pinned_time: null,
      is_starred: null,
    },
    {
      id: "c2",
      title: "Kubernetes basics",
      create_time: "2024-01-02T00:00:00Z",
      update_time: "2024-01-02T00:00:00Z",
      conversation_template_id: null,
      gizmo_id: null,
      is_archived: false,
      pinned_time: null,
      is_starred: null,
    },
  ],
  total: 2,
  limit: 100,
  offset: 0,
  has_missing_conversations: false,
};

const detail = {
  title: "Sourdough starter",
  create_time: "2024-01-01T00:00:00Z",
  update_time: "2024-01-01T00:00:00Z",
  is_archived: false,
  gizmo_id: null,
  conversation_template_id: null,
  current_node: "a1",
  mapping: {
    root: { id: "root", message: null, parent: null },
    u1: {
      id: "u1", parent: "root",
      message: { author: { role: "user" }, create_time: "2024-01-01T00:00:00Z", content: { content_type: "text", parts: ["How do I start a starter?"] }, metadata: {} },
    },
    a1: {
      id: "a1", parent: "u1",
      message: { author: { role: "assistant" }, create_time: "2024-01-01T00:00:05Z", content: { content_type: "text", parts: ["Mix flour and water and wait."] }, metadata: {} },
    },
  },
};

async function routeChatgpt(context: BrowserContext, deletedIds: string[]): Promise<void> {
  await context.route("https://chatgpt.com/**", async (route) => {
    const url = new URL(route.request().url());
    const send = (body: unknown) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
      headers: { "access-control-allow-origin": "*" },
    });
    if (url.pathname === "/api/auth/session") {
      return send({ user: { id: "u-e2e", name: "Fixture" }, accessToken: "fixture-token", expires: "2030-01-01T00:00:00Z" });
    }
    if (url.pathname === "/backend-api/conversations") {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      return send({ ...conversations, items: offset === 0 ? conversations.items : [], offset });
    }
    if (url.pathname === "/backend-api/gizmos/snorlax/sidebar") {
      return send({
        items: [{ gizmo: { gizmo: { id: "g-p-work", gizmo_type: "snorlax", display: { name: "Work", description: "" } }, tools: [], files: [] }, conversations: { items: [] } }],
        cursor: null,
      });
    }
    if (url.pathname.startsWith("/backend-api/conversation/")) {
      if (route.request().method() === "PATCH") {
        deletedIds.push(decodeURIComponent(url.pathname.split("/").pop() ?? ""));
        return send({ success: true });
      }
      return send(detail);
    }
    return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>ChatGPT fixture</title><main>fixture</main>" });
  });
}

test("installed extension loads conversations through its isolated content script", async () => {
  const profile = await mkdtemp(resolve(".work/tmp/mv3-chatgpt-profile-"));
  const deletedIds: string[] = [];
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await routeChatgpt(context, deletedIds);

    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    expect(worker.url()).toBe(`chrome-extension://${extensionId}/service-worker.js`);

    const chatgpt = await context.newPage();
    await chatgpt.goto("https://chatgpt.com/");
    await expect(chatgpt).toHaveTitle("ChatGPT fixture");

    const dashboard = await context.newPage();
    await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html`);
    await expect(dashboard.locator(".brand")).toContainText("ChatGPT Organizer");
    await expect(dashboard.locator(".row")).toHaveCount(2, { timeout: 20_000 });
    await expect(dashboard.locator(".row").first()).toContainText("Sourdough starter");
    await expect(dashboard.locator(".row").nth(1)).toContainText("Kubernetes basics");
    await expect(dashboard.getByRole("button", { name: "Run queue" })).toBeDisabled();

    const chatgptTabId = await dashboard.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
      const id = tabs[0]?.id;
      if (id === undefined) throw new Error("No ChatGPT tab");
      return id;
    });

    const unarmed = await dashboard.evaluate(async (tabId) => new Promise<{
      ok: boolean;
      error?: { kind: string; message: string };
    }>((resolve) => {
      chrome.tabs.sendMessage(tabId, {
        kind: "chatgpt/api",
        requestId: "unarmed",
        op: "change",
        id: "c2",
        runId: "not-armed",
        action: "delete",
        body: { is_visible: false },
      }, (response: unknown) => resolve(response as { ok: boolean; error?: { kind: string; message: string } }));
    }), chatgptTabId);
    expect(unarmed.ok).toBe(false);
    expect(unarmed.error?.kind).toBe("auth");
    expect(deletedIds).toEqual([]);

    const arm = await dashboard.evaluate(async (tabId) => new Promise<{ ok: boolean }>((resolve) => {
      chrome.tabs.sendMessage(tabId, {
        kind: "chatgpt/api", requestId: "arm-e2e", op: "arm", runId: "run-e2e",
        jobs: [{ id: "c2", action: "delete" }],
      }, (response: unknown) => resolve(response as { ok: boolean }));
    }), chatgptTabId);
    expect(arm.ok).toBe(true);

    const sendChange = (id: string, runId: string): Promise<{ ok: boolean; error?: { kind: string } }> =>
      dashboard.evaluate(async ({ tabId, chatId, authorizedRun }) => new Promise<{ ok: boolean; error?: { kind: string } }>((resolve) => {
        chrome.tabs.sendMessage(tabId, {
          kind: "chatgpt/api", requestId: `change-${chatId}`, op: "change", id: chatId,
          runId: authorizedRun, action: "delete", body: { is_visible: false },
        }, (response: unknown) => resolve(response as { ok: boolean; error?: { kind: string } }));
      }), { tabId: chatgptTabId, chatId: id, authorizedRun: runId });

    expect((await sendChange("c1", "run-e2e")).ok).toBe(false);
    expect(deletedIds).toEqual([]);
    expect((await sendChange("c2", "run-e2e")).ok).toBe(true);
    await expect.poll(() => deletedIds).toEqual(["c2"]);
    expect((await sendChange("c1", "run-e2e")).ok).toBe(false);
    expect(deletedIds).toEqual(["c2"]);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
