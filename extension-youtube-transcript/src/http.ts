const responseCache = new Map<string, Promise<Response>>();

export function clearResponseCache(): void {
  responseCache.clear();
}

export function cachedFetch(fetchImpl: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const key = init?.body ? `${url}::${init.body}` : url;

    const cached = responseCache.get(key);
    if (cached) {
      try {
        const response = await cached;
        if (response.ok) return response.clone();
      } catch {
        // Cached promise rejected — fall through to re-fetch
      }
      responseCache.delete(key);
    }

    const promise = fetchImpl(input, init);
    responseCache.set(key, promise);
    const response = await promise;
    if (!response.ok) {
      responseCache.delete(key);
      return response;
    }
    return response.clone();
  };
}
