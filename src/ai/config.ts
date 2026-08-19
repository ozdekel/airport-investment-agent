/**
 * Model selection.
 *
 * WHY THIS FILE EXISTS: the previous version of this project hardcoded
 * `model: 'openrouter/free'`, which is not a real model id. Every LLM call
 * 400'd, the catch block swallowed it, and the agent silently answered "I could
 * not identify any airport" to every question. A hardcoded model id is a
 * time bomb - provider catalogues churn constantly.
 *
 * So we resolve the model at runtime: ask OpenRouter what it actually serves,
 * and take the first entry from our preference list that exists. If the
 * catalogue itself is unreachable we optimistically use the first preference
 * and let the call-level fallback handle it.
 */

import { fetchJson } from '@/data/http';
import { cached, TTL } from '@/data/cache';

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

/** Ordered by preference. First one the provider actually serves wins. */
export const MODEL_PREFERENCES = {
  // Both roles run on the cheapest Gemini tier on purpose. This is a
  // one-day build: the thing being evaluated is whether the deterministic
  // logic and the methodology hold up, not whether we picked a clever model.
  // The LLM only classifies intent and writes prose - neither job needs a
  // frontier model, and a cheap one keeps the demo fast and free to re-run.
  reasoning: [
    'google/gemini-3.5-flash-lite',
    'google/gemini-3.6-flash',
    'google/gemini-3.7-flash',
  ],
  fast: [
    'google/gemini-3.5-flash-lite',
    'google/gemini-3.6-flash',
  ],
} as const;

export type ModelRole = keyof typeof MODEL_PREFERENCES;

async function availableModelIds(): Promise<Set<string> | null> {
  return cached('openrouter:catalog', TTL.MODEL_CATALOG, async () => {
    const res = await fetchJson<{ data: Array<{ id: string }> }>(
      `${OPENROUTER_BASE}/models`, {}, { label: 'openrouter:catalog', timeoutMs: 6000 },
    );
    if (!res.ok) {
      console.warn('[ai] model catalogue unreachable; using first preference blind');
      return null;
    }
    return new Set(res.data.data.map((m) => m.id));
  });
}

export async function resolveModel(role: ModelRole): Promise<string> {
  const override = role === 'reasoning'
    ? process.env.OPENROUTER_MODEL_REASONING
    : process.env.OPENROUTER_MODEL_FAST;
  if (override) return override;

  const catalog = await availableModelIds();
  const prefs = MODEL_PREFERENCES[role];
  if (!catalog) return prefs[0];

  const found = prefs.find((id) => catalog.has(id));
  if (!found) {
    console.warn(`[ai] none of the preferred ${role} models are served; falling back to ${prefs[0]}`);
    return prefs[0];
  }
  console.log(`[ai] resolved ${role} model -> ${found}`);
  return found;
}
