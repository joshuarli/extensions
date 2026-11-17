import { readFileSync } from "node:fs";
import { SqliteProfileStore } from "../../src/profile-db.ts";
import { syncContextThreads } from "../../src/context.ts";

const store = new SqliteProfileStore(process.argv[2]!, "1000");
const save = store.saveContextPage.bind(store);
let saves = 0;
store.saveContextPage = async (items, targetUserId) => {
  saves++;
  if (saves === Number(process.argv[3] ?? "1")) process.kill(process.pid, "SIGKILL");
  await save(items, targetUserId);
};
await syncContextThreads({
  store,
  targetUserId: "1000",
  signal: new AbortController().signal,
  report: () => {},
  fetchHtml: async () => readFileSync(new URL("./conversation-page.html", import.meta.url), "utf8"),
  pageDelayMs: 0,
});
throw new Error("Context save was not reached");
