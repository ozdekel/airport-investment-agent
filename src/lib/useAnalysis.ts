'use client';

import { useCallback, useRef, useState } from 'react';
import { InvestmentScore, ScoringWeights } from '@/core/types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  origin?: 'llm' | 'deterministic';
  guardrail?: { passed: boolean; violations: string[] };
}

export interface PipelineStage { stage: string; message: string }

/**
 * Consumes the SSE pipeline.
 *
 * The point of streaming here is that the dashboard does not wait for prose.
 * `scores` lands as soon as the deterministic engine finishes, several seconds
 * before the narration, and the stage messages the user reads are the real
 * pipeline steps rather than a timer cycling through plausible-sounding text.
 */
export function useAnalysis(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'welcome', role: 'assistant', content: 'I score airports on how far **demand has outrun infrastructure** - saturation is the opportunity. Ask me to compare two airports, or which airports in a country or continent are worth expanding.' },
  ]);
  const [scores, setScores] = useState<InvestmentScore[] | null>(null);
  const [weights, setWeights] = useState<ScoringWeights | null>(null);
  const [stage, setStage] = useState<PipelineStage | null>(null);
  const [trace, setTrace] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (userQuery: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: 'user', content: userQuery }]);
    setBusy(true);
    setTrace([]);
    setElapsedMs(null);
    setStage({ stage: 'intent', message: 'Reading the question...' });

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userQuery, sessionId }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const evLine = frame.split('\n').find((l) => l.startsWith('event: '));
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!evLine || !dataLine) continue;

          const event = evLine.slice(7).trim();
          let payload: Record<string, unknown>;
          try { payload = JSON.parse(dataLine.slice(6)); } catch { continue; }

          if (event === 'stage') setStage(payload as unknown as PipelineStage);
          else if (event === 'trace') setTrace((t) => [...t, String(payload.line)]);
          else if (event === 'weights') setWeights(payload as unknown as ScoringWeights);
          else if (event === 'scores') {
            setScores(payload.scores as InvestmentScore[]);
            if (payload.weights) setWeights(payload.weights as ScoringWeights);
          } else if (event === 'narration') {
            setMessages((m) => [...m, {
              id: `a-${Date.now()}`,
              role: 'assistant',
              content: String(payload.text),
              origin: payload.origin as ChatMessage['origin'],
              guardrail: payload.guardrail as ChatMessage['guardrail'],
            }]);
          } else if (event === 'done') {
            setElapsedMs(Number(payload.elapsedMs));
          }
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setMessages((m) => [...m, {
          id: `e-${Date.now()}`, role: 'assistant',
          content: 'I lost the connection to the analysis service. The scores already on screen are still valid - try the question again.',
          origin: 'deterministic',
        }]);
      }
    } finally {
      setBusy(false);
      setStage(null);
    }
  }, [sessionId]);

  const reset = useCallback(() => {
    setMessages([{ id: 'welcome', role: 'assistant', content: 'New session. What should I look at?' }]);
    setScores(null); setTrace([]); setElapsedMs(null);
  }, []);

  return { messages, scores, weights, stage, trace, busy, elapsedMs, send, reset };
}
