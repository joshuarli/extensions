import { expect, test } from "vitest";
import { createActionStatus } from "../src/action-status.ts";

function harness() {
  const calls: string[] = [],
    status = createActionStatus("Browser Extensions", {
      setTitle: (tabId, title) => {
        calls.push(`title:${tabId}:${title}`);
      },
      setBadgeText: (tabId, text) => {
        calls.push(`badge:${tabId}:${text}`);
      },
      setBadgeBackgroundColor: (tabId, color) => {
        calls.push(`color:${tabId}:${color}`);
      },
    });
  return { calls, status };
}

test("resolves title and badge independently by feature priority", () => {
  const { calls, status } = harness();

  status.set("allow-right-click", 1, { badge: "ON", badgeColor: "#188038" });
  expect(calls).toEqual([
    "title:1:Browser Extensions",
    "badge:1:ON",
    "color:1:#188038",
  ]);

  calls.length = 0;
  status.set("onefile", 1, {
    title: "Onefile is saving…",
    badge: "10%",
    badgeColor: "#1a73e8",
  });
  expect(calls).toEqual([
    "title:1:Onefile is saving…",
    "badge:1:10%",
    "color:1:#1a73e8",
  ]);

  calls.length = 0;
  status.set("youtube-transcript", 1, { title: "Fetching transcript…" });
  expect(calls).toEqual([]);

  calls.length = 0;
  status.clear("onefile", 1);
  expect(calls).toEqual([
    "title:1:Fetching transcript…",
    "badge:1:ON",
    "color:1:#188038",
  ]);

  calls.length = 0;
  status.clear("allow-right-click", 1);
  expect(calls).toEqual(["badge:1:"]);

  calls.length = 0;
  status.clear("youtube-transcript", 1);
  expect(calls).toEqual(["title:1:Browser Extensions"]);
});

test("clearing a tab resets its action state without touching another tab", () => {
  const { calls, status } = harness();

  status.set("allow-right-click", 1, { badge: "ON", badgeColor: "#188038" });
  status.set("allow-right-click", 2, { badge: "ON", badgeColor: "#188038" });
  calls.length = 0;

  status.clearTab(2);
  expect(calls).toEqual(["badge:2:"]);

  calls.length = 0;
  status.forgetTab(1);
  expect(calls).toEqual([]);
});
