import { afterEach, expect, test, vi } from "vitest";

let chromeApi: Record<string, unknown> | undefined,
  originalRuntime: PropertyDescriptor | undefined;

afterEach(() => {
  for (const cleanup of window.pointers?.run ?? []) cleanup();
  Reflect.deleteProperty(window, "pointers");
  document.body.replaceChildren();
  if (chromeApi) {
    if (originalRuntime) {
      Object.defineProperty(chromeApi, "runtime", originalRuntime);
    } else {
      Reflect.deleteProperty(chromeApi, "runtime");
    }
  }
});

test("teardown restores the original inline user-select value", async () => {
  const chromeNamespace: unknown = Reflect.get(window, "chrome");
  if (typeof chromeNamespace !== "object" || chromeNamespace === null) {
    throw new Error("Chromium did not expose its chrome namespace.");
  }
  chromeApi = chromeNamespace as Record<string, unknown>;
  originalRuntime = Object.getOwnPropertyDescriptor(chromeApi, "runtime");
  Object.assign(chromeApi, { runtime: { sendMessage: () => Promise.resolve() } });
  const element = document.createElement("div");
  element.style.setProperty("user-select", "none");
  document.body.append(element);

  // @ts-expect-error Vite uses the query to execute a fresh injection instance.
  await import("../src/data/inject/core.ts?activate");
  // @ts-expect-error Vite uses the query to execute a fresh injection instance.
  await import("../src/data/inject/user-select/isolated.ts?activate");
  await vi.waitFor(() => {
    expect(element.style.getPropertyValue("user-select")).toBe("initial");
  });

  // @ts-expect-error Vite uses the query to execute a fresh injection instance.
  await import("../src/data/inject/core.ts?deactivate");

  expect(element.style.getPropertyValue("user-select")).toBe("none");
});
