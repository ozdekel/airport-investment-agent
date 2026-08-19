/**
 * Server-side conversation state.
 *
 * WHY SERVER-SIDE: follow-ups like "and the delays there?" or "drop the weight
 * on growth" only work if the server remembers what "there" refers to and what
 * the current weights are. Replaying the whole transcript to the LLM every turn
 * and hoping it re-derives the context is slower, costlier and less reliable.
 *
 * TRADEOFF: this is an in-process Map. It does not survive a restart and does
 * not work across multiple instances. For a single-process take-home that is
 * the right call; the interface is narrow enough that swapping in Redis is a
 * one-file change. See TRADEOFFS.md.
 */

import { InvestmentScore, ScoringWeights } from '@/core/types';
import { DEFAULT_WEIGHTS } from '@/core/assumptions';

export interface ConversationState {
  /** IATA codes currently in focus - what "there" and "them" resolve to. */
  focusAirports: string[];
  weights: ScoringWeights;
  lastScores: InvestmentScore[];
  /** Short rolling summary fed to the narrator for continuity. */
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  updatedAt: number;
}

const SESSIONS = new Map<string, ConversationState>();
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_HISTORY = 12;

function fresh(): ConversationState {
  return { focusAirports: [], weights: { ...DEFAULT_WEIGHTS }, lastScores: [], history: [], updatedAt: Date.now() };
}

export function getSession(id: string): ConversationState {
  // Opportunistic sweep - no timers, no leak.
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [key, s] of SESSIONS) if (s.updatedAt < cutoff) SESSIONS.delete(key);

  const existing = SESSIONS.get(id);
  if (existing) return existing;

  const created = fresh();
  SESSIONS.set(id, created);
  return created;
}

export function updateSession(id: string, patch: Partial<ConversationState>): ConversationState {
  const current = getSession(id);
  const next = { ...current, ...patch, updatedAt: Date.now() };
  if (next.history.length > MAX_HISTORY) next.history = next.history.slice(-MAX_HISTORY);
  SESSIONS.set(id, next);
  return next;
}

export function appendTurn(id: string, role: 'user' | 'assistant', content: string) {
  const s = getSession(id);
  return updateSession(id, { history: [...s.history, { role, content }] });
}

/** A compact recap for the narrator, so it can refer back without re-reading everything. */
export function summarise(state: ConversationState): string {
  if (state.lastScores.length === 0) return '';
  const parts = state.lastScores.map((s) => `${s.airport.iata} scored ${s.finalScore}`);
  return `previously analysed ${parts.join(', ')}`;
}
