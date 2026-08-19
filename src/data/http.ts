/**
 * Hardened fetch for every outbound call.
 *
 * Assumption baked in here: external APIs WILL time out, rate-limit and return
 * malformed bodies. Nothing above this layer is allowed to throw a raw network
 * error at the user, so every caller gets a typed result instead of an
 * exception it might forget to catch.
 */

export type Fetched<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'timeout' | 'rate_limited' | 'http_error' | 'bad_payload' | 'network'; detail: string };

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  { timeoutMs = 8000, label = 'http' }: { timeoutMs?: number; label?: string } = {},
): Promise<Fetched<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const ms = Date.now() - started;

    if (res.status === 429) {
      console.warn(`[${label}] rate limited after ${ms}ms`);
      return { ok: false, reason: 'rate_limited', detail: 'HTTP 429' };
    }
    if (!res.ok) {
      console.warn(`[${label}] HTTP ${res.status} after ${ms}ms`);
      return { ok: false, reason: 'http_error', detail: `HTTP ${res.status}` };
    }

    const text = await res.text();
    // OpenSky answers an empty body when a window has no data. That is a valid
    // "nothing here", not a failure, so it maps to an empty array.
    if (!text.trim()) return { ok: true, data: [] as unknown as T };

    try {
      console.log(`[${label}] ok in ${ms}ms`);
      return { ok: true, data: JSON.parse(text) as T };
    } catch {
      return { ok: false, reason: 'bad_payload', detail: text.slice(0, 200) };
    }
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    console.warn(`[${label}] ${isAbort ? 'timeout' : 'network error'}: ${String(err)}`);
    return {
      ok: false,
      reason: isAbort ? 'timeout' : 'network',
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}
