/**
 * Tiny TTL cache.
 *
 * Why not Redis: this is a single-process demo and an external cache would be
 * infrastructure theatre. The interface is deliberately narrow so swapping in
 * Redis later touches one file.
 *
 * Why it matters: every external quota we depend on is small (OpenSky gives
 * 400 anonymous credits/day, AviationStack 100 requests/MONTH). Caching is not
 * an optimisation here, it is what keeps the demo alive.
 */

interface Entry<T> { value: T; expiresAt: number }

const store = new Map<string, Entry<unknown>>();

export function cacheGet<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) { store.delete(key); return undefined; }
  return hit.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): T {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/** Memoise an async producer behind the cache. Failures are never cached. */
export async function cached<T>(key: string, ttlMs: number, produce: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) {
    console.log(`[cache] HIT  ${key}`);
    return hit;
  }
  console.log(`[cache] MISS ${key}`);
  return cacheSet(key, await produce(), ttlMs);
}

export const TTL = {
  OPENSKY_WINDOW: 6 * 60 * 60 * 1000,   // operations windows are historical, safe to hold
  AVIATIONSTACK: 60 * 60 * 1000,        // brutal quota, hold aggressively
  WINDOW_PROBE: 24 * 60 * 60 * 1000,   // a provider's retention window does not move hourly
  MODEL_CATALOG: 30 * 60 * 1000,
} as const;

export function cacheStats() {
  return { entries: store.size, keys: [...store.keys()] };
}
