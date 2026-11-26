import { Effect, Schema } from "effect";
import { collectThread, HnArchiveError, validId, type HnItem, type ThreadArchive } from "./thread.ts";

const ItemSchema = Schema.Struct({
  id: Schema.Number,
  type: Schema.optional(Schema.Literals(["story", "job", "poll", "comment", "pollopt"])),
  by: Schema.optional(Schema.String), time: Schema.optional(Schema.Number),
  title: Schema.optional(Schema.String), text: Schema.optional(Schema.String), url: Schema.optional(Schema.String),
  score: Schema.optional(Schema.Number), descendants: Schema.optional(Schema.Number),
  parent: Schema.optional(Schema.Number), poll: Schema.optional(Schema.Number),
  kids: Schema.optional(Schema.Array(Schema.Number)), parts: Schema.optional(Schema.Array(Schema.Number)),
  deleted: Schema.optional(Schema.Boolean), dead: Schema.optional(Schema.Boolean),
});

export function decodeItem(value: unknown, id: number): HnItem {
  if (value === null) throw new HnArchiveError(`HN item ${id} is unavailable.`);
  try {
    const item = Schema.decodeUnknownSync(ItemSchema)(value);
    if (item.id !== id || !validId(item.id) || (!item.type && !item.deleted)) throw new Error();
    for (const related of [...(item.kids ?? []), ...(item.parts ?? []), ...(item.parent === undefined ? [] : [item.parent]), ...(item.poll === undefined ? [] : [item.poll])]) {
      if (!validId(related)) throw new Error();
    }
    for (const n of [item.time, item.score, item.descendants]) {
      if (n !== undefined && !Number.isSafeInteger(n)) throw new Error();
    }
    return item;
  } catch {
    throw new HnArchiveError(`Malformed response for HN item ${id}.`);
  }
}

export function fetchThread(id: number, fetchImpl = globalThis.fetch): Effect.Effect<ThreadArchive, HnArchiveError> {
  return Effect.tryPromise({
    try: async (signal) => {
      const controller = new AbortController();
      const deadline = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(120_000)]);
      try {
        return await collectThread(id, async (itemId) => {
          for (let attempt = 0; ; attempt++) {
            const requestSignal = AbortSignal.any([deadline, AbortSignal.timeout(15_000)]);
            let response: Response;
            try {
              response = await fetchImpl(`https://hacker-news.firebaseio.com/v0/item/${itemId}.json`, {
                signal: requestSignal, credentials: "omit", redirect: "error", cache: "no-store",
              });
            } catch (error) {
              if (attempt === 0 && !deadline.aborted) continue;
              throw new HnArchiveError(`HN item ${itemId} request failed: ${String(error)}`);
            }
            if (!response.ok) {
              await response.body?.cancel();
              if (attempt === 0 && (response.status === 429 || response.status >= 500) && !deadline.aborted) {
                await new Promise<void>((resolve) => setTimeout(resolve, 500));
                continue;
              }
              throw new HnArchiveError(`HN item ${itemId}: HTTP ${response.status}.`);
            }
            const value: unknown = await response.json();
            return decodeItem(value, itemId);
          }
        });
      } finally {
        controller.abort();
      }
    },
    catch: (error) => error instanceof HnArchiveError ? error : new HnArchiveError(String(error)),
  });
}
