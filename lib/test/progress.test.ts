import { describe, expect, it } from "vitest";
import { createProgressReporter } from "../progress.ts";

function stream() {
  let text = "";
  return {
    isTTY: false,
    write(chunk: string) { text += chunk; return true; },
    get text() { return text; },
  };
}

describe("progress reporter", () => {
  it("reports phase, counts and percentage", () => {
    const out = stream();
    const progress = createProgressReporter(out, 0);
    progress.update({ phase: "records", done: 3, total: 10 });
    progress.finish("archived 10 chats");
    expect(out.text).toContain("records 3/10");
    expect(out.text).toContain(" 30%");
    expect(out.text).not.toContain("eta");
    expect(out.text).toContain("archived 10 chats");
  });

  it("handles unknown totals without a percentage", () => {
    const out = stream();
    const progress = createProgressReporter(out, 0);
    progress.update({ phase: "listing", done: 7, total: null, note: "page 2" });
    expect(out.text).toContain("listing 7");
    expect(out.text).not.toContain("%");
    expect(out.text).toContain("page 2");
  });

  it("does not repeat an identical update", () => {
    const out = stream();
    const progress = createProgressReporter(out, 0);
    progress.update({ phase: "records", done: 1, total: 2 });
    progress.update({ phase: "records", done: 1, total: 2 });
    expect(out.text.split("\n").filter(Boolean)).toHaveLength(1);
  });
});
