import { expect, test, chromium, type BrowserContext, type Page } from "playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chatgptDashboardPath } from "../../src/background.ts";
import { FakeChatgpt } from "./fake-chatgpt.ts";

const extensionPath = resolve("build/extension-suite");

interface Saved {
  name: string;
  text: string;
}

interface Harness {
  context: BrowserContext;
  extensionId: string;
  chatgpt: Page;
  openDashboard(): Promise<Page>;
}

async function withExtension(server: FakeChatgpt, body: (harness: Harness) => Promise<void>): Promise<void> {
  const profile = await mkdtemp(resolve(".work/tmp/mv3-chatgpt-profile-"));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    // A file picker that records what the dashboard writes, standing in for the native dialog.
    await context.addInitScript(() => {
      const target = window as unknown as {
        __saved: { name: string; text: string }[];
        __cancelSave: boolean;
        showSaveFilePicker: (options: { suggestedName: string }) => Promise<unknown>;
      };
      target.__saved = [];
      target.__cancelSave = false;
      target.showSaveFilePicker = async (options) => {
        if (target.__cancelSave) throw new DOMException("The user aborted a request.", "AbortError");
        const chunks: string[] = [];
        const name = options.suggestedName;
        return {
          name,
          async createWritable() {
            return {
              async write(data: string) { chunks.push(data); },
              async close() { target.__saved.push({ name, text: chunks.join("") }); },
            };
          },
          async getFile() { return new File(chunks, name); },
        };
      };
    });
    await server.install(context);
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    const chatgpt = await context.newPage();
    await chatgpt.goto("https://chatgpt.com/");
    await expect(chatgpt).toHaveTitle("ChatGPT fixture");
    const opened = context;
    await body({
      context: opened,
      extensionId,
      chatgpt,
      async openDashboard() {
        const page = await opened.newPage();
        await page.goto(`chrome-extension://${extensionId}/${chatgptDashboardPath}`);
        return page;
      },
    });
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
}

function row(page: Page, title: string) {
  return page.locator(".row", { hasText: title });
}

async function savedFiles(page: Page): Promise<Saved[]> {
  return page.evaluate(() => (window as unknown as { __saved: Saved[] }).__saved);
}

async function reviewAndRun(page: Page, expectRows: string[]): Promise<void> {
  await page.keyboard.press("q");
  const dialog = page.getByRole("dialog", { name: "Review and run" });
  await expect(dialog).toBeVisible();
  const reviewed = await dialog.locator("tbody tr").allInnerTexts();
  expect(reviewed.map((text) => text.replace(/\s+/gu, " ").trim())).toEqual(expectRows);
  await dialog.getByLabel("Seconds between changes").fill("3");
  await dialog.getByRole("button", { name: /^Run / }).click();
}

async function sendRaw(page: Page, message: Record<string, unknown>): Promise<{ ok: boolean; error: { kind: string } | null }> {
  return page.evaluate(async (body) => {
    const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
    const id = tabs[0]?.id;
    if (id === undefined) throw new Error("No ChatGPT tab");
    return new Promise((done) => {
      chrome.tabs.sendMessage(id, { kind: "chatgpt/api", requestId: "raw", ...body }, done);
    });
  }, message);
}

const fixture = () => new FakeChatgpt([
  { id: "c1", title: "Sourdough starter" },
  { id: "c2", title: "Kubernetes basics" },
  { id: "c3", title: "Tax questions", projectId: "g-p-work" },
  { id: "c4", title: "Trip to Lisbon" },
  { id: "c5", title: "Old archived chat", archived: true },
]);

test("deletes only after a verified backup is saved, and only the reviewed changes", async () => {
  const server = fixture();
  await withExtension(server, async ({ openDashboard }) => {
    const page = await openDashboard();
    await expect(page.locator(".row")).toHaveCount(4, { timeout: 20_000 });
    await row(page, "Sourdough starter").click();
    await page.keyboard.press("d");
    await expect(row(page, "Sourdough starter")).toContainText("Delete");
    await row(page, "Kubernetes basics").click();
    await page.keyboard.press("a");
    await reviewAndRun(page, ["1 Sourdough starter Deleted permanently", "2 Kubernetes basics Moved to Archived"]);

    await expect(page.getByRole("button", { name: "Save backup & continue" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Pause" })).toHaveCount(0);
    expect(server.patches).toEqual([]);

    await page.getByRole("button", { name: "Save backup & continue" }).click();
    await expect(page.locator(".status")).toContainText("done", { timeout: 40_000 });
    expect(server.patches).toEqual([
      { id: "c1", body: { is_visible: false }, status: 200 },
      { id: "c2", body: { is_archived: true }, status: 200 },
    ]);
    const [backup] = await savedFiles(page);
    const parsed = JSON.parse(backup?.text ?? "{}") as { conversations: { id: string; record: { mapping: object } }[] };
    expect(parsed.conversations.map((entry) => entry.id)).toEqual(["c1"]);
    expect(Object.keys(parsed.conversations[0]?.record.mapping ?? {})).toEqual(["a1", "root", "u1"]);

    const after = await sendRaw(page, { op: "change", runId: "anything", leaseId: "closed", accountId: "u-e2e", id: "c3" });
    expect(after.ok).toBe(false);
    expect(after.error?.kind).toBe("auth");
    const armed = await sendRaw(page, { op: "arm", runId: "sneaky", leaseId: "closed", accountId: "u-e2e", commands: [{ action: "delete", id: "c3" }] });
    expect(armed.ok).toBe(false);
    expect(server.applied("c3")?.visible).toBe(true);
  });
});

test("a backup that was cancelled or lost to a reload never lets deletion through", async () => {
  const server = fixture();
  await withExtension(server, async ({ openDashboard }) => {
    const page = await openDashboard();
    await expect(page.locator(".row")).toHaveCount(4, { timeout: 20_000 });
    await row(page, "Trip to Lisbon").click();
    await page.keyboard.press("d");
    await reviewAndRun(page, ["1 Trip to Lisbon Deleted permanently"]);
    const save = page.getByRole("button", { name: "Save backup & continue" });
    await expect(save).toBeVisible({ timeout: 20_000 });

    await page.evaluate(() => { (window as unknown as { __cancelSave: boolean }).__cancelSave = true; });
    await save.click();
    await expect(page.locator(".footer")).toContainText("wasn't saved");
    await expect(save).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".status")).toContainText("Interrupted");
    expect(server.patches).toEqual([]);

    await page.getByRole("button", { name: "Resume" }).click();
    await expect(save).toBeVisible({ timeout: 20_000 });
    expect(server.patches).toEqual([]);
    await save.click();
    await expect(page.locator(".status")).toContainText("done", { timeout: 30_000 });
    expect(server.patches).toEqual([{ id: "c4", body: { is_visible: false }, status: 200 }]);
  });
});

test("an uncertain or rate-limited write is reconciled instead of repeated", async () => {
  const server = fixture();
  server.loseResponseFor.add("c1");
  server.rateLimitPatches = 1;
  await withExtension(server, async ({ openDashboard }) => {
    const page = await openDashboard();
    await expect(page.locator(".row")).toHaveCount(4, { timeout: 20_000 });
    await row(page, "Sourdough starter").click();
    await page.keyboard.press("a");
    await row(page, "Kubernetes basics").click();
    await page.keyboard.press("a");
    await reviewAndRun(page, ["1 Sourdough starter Moved to Archived", "2 Kubernetes basics Moved to Archived"]);
    await expect(page.locator(".status")).toContainText("done", { timeout: 60_000 });
    expect(server.patches.map((patch) => `${patch.id}:${patch.status}`)).toEqual(["c1:429", "c1:500", "c2:200"]);
    await expect(page.locator(".queued-body")).toContainText("uncertain response");
    expect(server.applied("c1")?.archived).toBe(true);
  });
});

test("a ChatGPT tab reload mid-run switches changes off until a deliberate resume", async () => {
  const server = fixture();
  await withExtension(server, async ({ openDashboard, chatgpt }) => {
    const page = await openDashboard();
    await expect(page.locator(".row")).toHaveCount(4, { timeout: 20_000 });
    for (const title of ["Sourdough starter", "Kubernetes basics", "Trip to Lisbon"]) {
      await row(page, title).click();
      await page.keyboard.press("a");
    }
    await reviewAndRun(page, ["1 Sourdough starter Moved to Archived", "2 Kubernetes basics Moved to Archived", "3 Trip to Lisbon Moved to Archived"]);
    await expect.poll(() => server.patches.length, { timeout: 20_000 }).toBe(1);
    await chatgpt.reload();
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".status")).toContainText("closed or reloaded");
    const paused = server.patches.length;
    await page.waitForTimeout(4000);
    expect(server.patches.length).toBe(paused);
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.locator(".status")).toContainText("done", { timeout: 40_000 });
    expect(server.patches.map((patch) => patch.id)).toEqual(["c1", "c2", "c4"]);
  });
});

test("only one dashboard runs at a time; a second takes over when the first closes", async () => {
  const server = fixture();
  await withExtension(server, async ({ openDashboard }) => {
    const first = await openDashboard();
    await expect(first.locator(".row")).toHaveCount(4, { timeout: 20_000 });
    const second = await openDashboard();
    await expect(second.getByText("open in another tab")).toBeVisible();
    await expect(second.getByRole("button", { name: "Run queue" })).toHaveCount(0);
    await first.close();
    await expect(second.locator(".row")).toHaveCount(4, { timeout: 20_000 });
  });
});

test("typing, selecting and filtering keep focus, the preview and the selection honest", async () => {
  const server = fixture();
  await withExtension(server, async ({ openDashboard }) => {
    const page = await openDashboard();
    await expect(page.locator(".row")).toHaveCount(4, { timeout: 20_000 });

    await page.keyboard.press("/");
    await page.keyboard.type("sour", { delay: 30 });
    await expect(page.locator(".search")).toBeFocused();
    await expect(page.locator(".search")).toHaveValue("sour");
    await expect(page.locator(".row")).toHaveCount(1);
    await page.locator(".search").fill("");
    await page.keyboard.press("Escape");

    await row(page, "Kubernetes basics").click();
    await expect(page.locator("#preview")).toContainText("Notes on Kubernetes basics.", { timeout: 10_000 });
    await page.keyboard.press("x");
    await expect(page.locator(".counts")).toContainText("1 selected");
    await expect(page.locator("#preview")).toContainText("Notes on Kubernetes basics.");

    await page.getByRole("button", { name: "Select all" }).click();
    await expect(page.locator(".counts")).toContainText("4 selected");
    await page.getByRole("button", { name: /^In projects/ }).click();
    await expect(page.locator(".counts")).toContainText("1 selected");
    await expect(page.locator(".footer")).toContainText("3 selected chats are hidden by this view and were deselected");
    await page.getByRole("button", { name: "Archived" }).click();
    await expect(page.locator(".counts")).toContainText("0 selected");
  });
});

test("an imported plan that names an unknown or renamed chat is rejected whole", async () => {
  const server = fixture();
  await withExtension(server, async ({ openDashboard }) => {
    const page = await openDashboard();
    await expect(page.locator(".row")).toHaveCount(4, { timeout: 20_000 });
    const plan = {
      version: 2,
      accountId: "u-e2e",
      protect: {},
      marks: {
        c1: { action: "delete", title: "Sourdough starter", newTitle: null, project: "", projectName: "", at: 0 },
        c2: { action: "delete", title: "Kubernetes (old title)", newTitle: null, project: "", projectName: "", at: 0 },
        "not-a-chat": { action: "delete", title: "Ghost", newTitle: null, project: "", projectName: "", at: 0 },
      },
    };
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import plan" }).click();
    await (await chooser).setFiles({ name: "plan.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(plan)) });
    const dialog = page.getByRole("dialog", { name: "Plan rejected" });
    await expect(dialog).toContainText("isn't in the loaded list");
    await expect(dialog).toContainText("stale");
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(page.locator(".counts")).toContainText("0 queued");
  });
});

test("a 3,200-chat account loads completely and stays responsive", async () => {
  test.setTimeout(180_000);
  const server = FakeChatgpt.generated(3200);
  const active = [...server.chats.values()].filter((chat) => !chat.archived).length;
  await withExtension(server, async ({ openDashboard }) => {
    const page = await openDashboard();
    await expect(page.locator(".row")).toHaveCount(active, { timeout: 150_000 });
    await expect(page.locator(".status")).not.toContainText("only loaded chats");
    await page.locator(".row").first().click();
    const timing = await page.evaluate(async () => {
      const step = async (key: string) => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        await new Promise((done) => setTimeout(done, 0));
      };
      const started = performance.now();
      for (let index = 0; index < 50; index += 1) await step("j");
      const moved = performance.now() - started;
      const marking = performance.now();
      await step("x");
      await step("d");
      return { perMove: moved / 50, mark: performance.now() - marking };
    });
    console.log(`3200 chats: ${timing.perMove.toFixed(1)} ms per focus move, ${timing.mark.toFixed(1)} ms to select and mark`);
    expect(timing.perMove).toBeLessThan(50);
    await expect(page.locator(".row.focus")).toContainText("Generated chat");
    await expect(page.locator(".counts")).toContainText("1 queued");
  });
});

async function queueRename(page: Page, current: string, replacement: string): Promise<void> {
  await row(page, current).click();
  await page.keyboard.press("r");
  await page.getByRole("textbox", { name: "New title" }).fill(replacement);
  await page.getByRole("button", { name: "Queue rename" }).click();
}

async function queueMove(page: Page, title: string, project: string): Promise<void> {
  await row(page, title).click();
  await page.keyboard.press("m");
  await page.getByRole("combobox", { name: "Project" }).selectOption(project);
  await page.getByRole("button", { name: "Queue move" }).click();
}

test("pause, edit and resume keeps replacement titles and Projects for a fresh review", async () => {
  const server = fixture();
  await withExtension(server, async ({ openDashboard }) => {
    const page = await openDashboard();
    await expect(page.locator(".row")).toHaveCount(4, { timeout: 20_000 });
    await row(page, "Sourdough starter").click();
    await page.keyboard.press("a");
    await queueRename(page, "Kubernetes basics", "Reviewed title");
    await queueMove(page, "Trip to Lisbon", "g-p-work");
    await reviewAndRun(page, [
      "1 Sourdough starter Moved to Archived",
      "2 Kubernetes basics Renamed to “Reviewed title”",
      "3 Trip to Lisbon Moved to Work",
    ]);
    await expect.poll(() => server.patches.length).toBe(1);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await queueRename(page, "Kubernetes basics", "Replacement title");
    await queueMove(page, "Trip to Lisbon", "g-p-home");
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(page.locator(".status")).toContainText("done", { timeout: 20_000 });
    expect(server.patches.map((patch) => patch.id)).toEqual(["c1"]);
    await expect(page.locator(".queued-body .held")).toHaveCount(2);
    await reviewAndRun(page, ["1 Kubernetes basics Renamed to “Replacement title”", "2 Trip to Lisbon Moved to Home"]);
    await expect(page.locator(".queued-body .verified")).toHaveCount(2, { timeout: 20_000 });
    await expect(page.locator(".status")).toContainText("done");
    expect(server.patches.slice(1).map((patch) => patch.body)).toEqual([
      { title: "Replacement title" },
      { gizmo_id: "g-p-home" },
    ]);
  });
});

test("closing the dashboard lease during account validation prevents the next PATCH", async () => {
  const server = fixture();
  await withExtension(server, async ({ context, openDashboard }) => {
    const page = await openDashboard();
    await expect(page.locator(".row")).toHaveCount(4, { timeout: 20_000 });
    for (const title of ["Sourdough starter", "Kubernetes basics"]) {
      await row(page, title).click();
      await page.keyboard.press("a");
    }
    await reviewAndRun(page, ["1 Sourdough starter Moved to Archived", "2 Kubernetes basics Moved to Archived"]);
    await expect.poll(() => server.patches.length).toBe(1);
    const validation = server.holdSession();
    const outcome = await Promise.race([
      validation.entered.then(() => "validating"),
      context.waitForEvent("request", { predicate: (request) => request.method() === "PATCH", timeout: 15_000 }).then(() => "PATCH"),
    ]);
    try {
      expect(outcome).toBe("validating");
      await page.close();
      const reopened = await openDashboard();
      await expect(reopened.getByRole("button", { name: "Resume", exact: true })).toBeVisible({ timeout: 20_000 });
      const rejected = context.waitForEvent("response", {
        predicate: (response) => new URL(response.url()).pathname === "/api/auth/session",
        timeout: 10_000,
      });
      validation.release();
      await (await rejected).finished();
      await row(reopened, "Kubernetes basics").click();
      await expect(reopened.locator("#preview")).toContainText("About Kubernetes basics");
      expect(server.patches.map((patch) => patch.id)).toEqual(["c1"]);
      await reopened.getByRole("button", { name: "Resume", exact: true }).click();
      await expect(reopened.locator(".status")).toContainText("done", { timeout: 20_000 });
      expect(server.patches.map((patch) => patch.id)).toEqual(["c1", "c2"]);
    } finally {
      validation.release();
    }
  });
});

test("switching the session behind an open dashboard pauses an armed run", async () => {
  const server = fixture();
  await withExtension(server, async ({ openDashboard }) => {
    const page = await openDashboard();
    await expect(page.locator(".row")).toHaveCount(4, { timeout: 20_000 });
    for (const title of ["Sourdough starter", "Kubernetes basics"]) {
      await row(page, title).click();
      await page.keyboard.press("a");
    }
    await reviewAndRun(page, ["1 Sourdough starter Moved to Archived", "2 Kubernetes basics Moved to Archived"]);
    await expect.poll(() => server.patches.length).toBe(1);
    server.accountId = "u-other";
    await expect(page.locator(".status")).toContainText(/paused.*account/i, { timeout: 15_000 });
    expect(server.patches.map((patch) => patch.id)).toEqual(["c1"]);
  });
});

test("retry verification survives dashboard reload and sends no second PATCH", async () => {
  const server = fixture();
  server.unfamiliarAcknowledgement = true;
  server.failListAfterPatch = true;
  await withExtension(server, async ({ openDashboard }) => {
    const page = await openDashboard();
    await expect(page.locator(".row")).toHaveCount(4, { timeout: 20_000 });
    await queueRename(page, "Kubernetes basics", "Replacement title");
    await reviewAndRun(page, ["1 Kubernetes basics Renamed to “Replacement title”"]);
    await expect(page.getByRole("button", { name: "Retry verification" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".queued-body .unverified")).toContainText("uncertain response");
    expect(server.patches).toHaveLength(1);

    server.failListAfterPatch = false;
    await page.reload();
    await page.getByRole("button", { name: "Retry verification" }).click({ timeout: 20_000 });
    await expect(page.locator(".status")).toContainText("done", { timeout: 20_000 });
    await expect(page.locator(".queued-body .verified")).toContainText("Replacement title");
    expect(server.patches).toHaveLength(1);
  });
});
