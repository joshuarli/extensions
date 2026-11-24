const responseCache = new Map<string, Promise<Response>>();

export function clearResponseCache(): void {
  responseCache.clear();
}

export function cachedFetch(fetchImpl: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const key = getResponseCacheKey(input, init);
    if (key === undefined) return fetchImpl(input, init);

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

function getResponseCacheKey(input: RequestInfo | URL, init?: RequestInit): string | undefined {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (input instanceof Request && init?.body === undefined && input.body !== null) {
    return undefined;
  }

  const body = init?.body;
  if (body === undefined || body === null) return url;
  return typeof body === "string" ? `${url}::${body}` : undefined;
}
