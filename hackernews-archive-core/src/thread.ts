export interface HnItem {
  readonly id: number;
  readonly type?: "story" | "job" | "poll" | "comment" | "pollopt" | undefined;
  readonly by?: string | undefined;
  readonly time?: number | undefined;
  readonly title?: string | undefined;
  readonly text?: string | undefined;
  readonly url?: string | undefined;
  readonly score?: number | undefined;
  readonly descendants?: number | undefined;
  readonly parent?: number | undefined;
  readonly poll?: number | undefined;
  readonly kids?: readonly number[] | undefined;
  readonly parts?: readonly number[] | undefined;
  readonly deleted?: boolean | undefined;
  readonly dead?: boolean | undefined;
}

export interface ThreadArchive {
  readonly format: "hackernews-thread";
  readonly version: 1;
  readonly requestedId: number;
  readonly rootId: number;
  readonly capturedAt: string;
  readonly items: readonly HnItem[];
}

export class HnArchiveError extends Error {}

export function isTombstone(item: HnItem): boolean {
  return item.deleted === true || item.dead === true;
}

export function validId(id: number): boolean {
  return Number.isSafeInteger(id) && id > 0;
}

export function threadId(input: string): number | undefined {
  if (/^[1-9][0-9]*$/u.test(input)) return validId(Number(input)) ? Number(input) : undefined;
  try {
    const url = new URL(input);
    const [id, ...rest] = url.searchParams.getAll("id");
    if (url.origin !== "https://news.ycombinator.com" || url.username || url.password ||
        url.pathname !== "/item" || rest.length || !id || !/^[1-9][0-9]*$/u.test(id)) return undefined;
    return validId(Number(id)) ? Number(id) : undefined;
  } catch {
    return undefined;
  }
}

export function itemUrl(id: number): string {
  return `https://news.ycombinator.com/item?id=${id}`;
}

type Edge = { id: number; parent: number; kind: "comment" | "pollopt" };

/** Follow the public API graph, not the paginated web page. Never return a partial archive. */
export async function collectThread(
  requestedId: number,
  load: (id: number) => Promise<HnItem>,
  capturedAt = new Date().toISOString(),
): Promise<ThreadArchive> {
  const limit = 10_000;
  const cache = new Map<number, HnItem>();
  async function get(id: number): Promise<HnItem> {
    if (!validId(id)) throw new HnArchiveError(`Invalid HN item ID: ${id}.`);
    const existing = cache.get(id);
    if (existing) return existing;
    const item = await load(id);
    if (item.id !== id) throw new HnArchiveError(`HN returned the wrong item for ${id}.`);
    cache.set(id, item);
    return item;
  }

  let root = await get(requestedId);
  const ancestors = new Set<number>([root.id]);
  while (root.type === "comment" || root.type === "pollopt" ||
      (root.type === undefined && isTombstone(root) && (root.parent !== undefined || root.poll !== undefined))) {
    const parent = root.type === "comment" ? root.parent : root.type === "pollopt" ? root.poll
      : root.parent === undefined ? root.poll : root.poll === undefined ? root.parent : undefined;
    if (parent === undefined || ancestors.has(parent) || ancestors.size >= limit) {
      throw new HnArchiveError(`Cannot resolve the thread containing ${requestedId}.`);
    }
    root = await get(parent);
    ancestors.add(root.id);
  }
  if (root.type !== "story" && root.type !== "job" && root.type !== "poll") {
    throw new HnArchiveError(`Item ${root.id} is not an HN submission.`);
  }

  const items = [root], seen = new Set<number>([root.id]), queue: Edge[] = [];
  function enqueue(item: HnItem, kind = item.type): void {
    function add(ids: readonly number[], kind: Edge["kind"]): void {
      for (const id of ids) {
        if (!validId(id) || seen.has(id)) throw new HnArchiveError(`Invalid or repeated HN child ${id}.`);
        if (seen.size >= limit) throw new HnArchiveError(`HN thread exceeds ${limit} items.`);
        seen.add(id);
        queue.push({ id, parent: item.id, kind });
      }
    }
    if (item.parts?.length && kind !== "poll") throw new HnArchiveError(`Unexpected poll options on ${item.id}.`);
    if (kind === "pollopt" && item.kids?.length) throw new HnArchiveError(`Unexpected replies on poll option ${item.id}.`);
    add(item.parts ?? [], "pollopt");
    add(item.kids ?? [], "comment");
  }
  enqueue(root);
  for (let offset = 0; offset < queue.length;) {
    const batch = queue.slice(offset, offset + 8);
    const loaded = await Promise.all(batch.map(async (edge) => {
      const item = await get(edge.id);
      const parent = edge.kind === "comment" ? item.parent : item.poll;
      if ((item.type !== edge.kind && !(isTombstone(item) && item.type === undefined)) ||
          (parent !== edge.parent && !(isTombstone(item) && parent === undefined))) {
        throw new HnArchiveError(`HN item ${item.id} does not belong to ${edge.parent}.`);
      }
      return { item, kind: edge.kind };
    }));
    for (const { item, kind } of loaded) {
      items.push(item);
      enqueue(item, kind);
    }
    offset += batch.length;
  }
  if (!seen.has(requestedId)) throw new HnArchiveError(`Requested item ${requestedId} is no longer in the thread.`);
  return { format: "hackernews-thread", version: 1, requestedId, rootId: root.id, capturedAt, items };
}
