/**
 * The single outbound path to the LLM.
 *
 * Contract: this function NEVER throws and NEVER returns a partial success.
 * Callers get either text or an explicit failure, so every consumer is forced
 * to have a deterministic fallback. That is what stops one flaky provider call
 * from taking the product down.
 */

import { fetchJson } from '@/data/http';
import { OPENROUTER_BASE, resolveModel, ModelRole } from './config';

export type LlmResult =
  | { ok: true; text: string; model: string }
  | { ok: false; reason: string };

interface ChatOptions {
  role: ModelRole;
  system?: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  label?: string;
}

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

export async function chat(opts: ChatOptions): Promise<LlmResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { ok: false, reason: 'OPENROUTER_API_KEY is not set' };

  const model = await resolveModel(opts.role);
  const label = opts.label ?? `llm:${opts.role}`;

  const messages = [
    ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
    { role: 'user', content: opts.user },
  ];

  const res = await fetchJson<ChatCompletion>(
    `${OPENROUTER_BASE}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
        'X-Title': 'AeroInvest - Airport Investment Agent',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 700,
      }),
    },
    { label, timeoutMs: opts.timeoutMs ?? 20000 },
  );

  if (!res.ok) return { ok: false, reason: `${res.reason}: ${res.detail}` };
  if (res.data.error) return { ok: false, reason: res.data.error.message ?? 'provider error' };

  const text = res.data.choices?.[0]?.message?.content?.trim();
  if (!text) return { ok: false, reason: 'empty completion' };

  return { ok: true, text, model };
}

/** Strips the markdown fences models insist on adding around JSON. */
export function extractJson(raw: string): unknown | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall back to the outermost balanced braces/brackets.
    const first = cleaned.search(/[[{]/);
    const last = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'));
    if (first === -1 || last <= first) return null;
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch { return null; }
  }
}
