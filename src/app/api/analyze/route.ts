/**
 * The orchestrator. Thin by design: it sequences the pipeline and streams
 * progress. All business logic lives in core/, all I/O in data/, all
 * generation in ai/.
 *
 * PIPELINE
 *   1. parse intent            (AI, with a rule-based fallback)
 *   2. resolve airports        (deterministic, validated against the dataset)
 *   3. build snapshots         (concurrent I/O, tiered degradation)
 *   4. score + rank            (deterministic, pure)
 *   5. stream scores           <- the dashboard populates HERE
 *   6. narrate + guard         (AI, validated)
 *
 * WHY SSE: step 4 finishes long before step 6. Holding the scores back until
 * the language model has finished writing would mean staring at a spinner while
 * data we already have sits in memory. The dashboard renders at step 5 and the
 * prose arrives after. The loading messages the analyst sees are real pipeline
 * stages, not a client-side timer pretending to be one.
 */

import { NextRequest } from 'next/server';
import { parseIntent, resolveAirports, rulesIntent } from '@/ai/intent';
import { narrate } from '@/ai/narrator';
import { buildSnapshot } from '@/data';
import { scoreAirport, rankAirports, normaliseWeights } from '@/core/scoring';
import { InvestmentScore } from '@/core/types';
import { getSession, updateSession, appendTurn, summarise } from '@/lib/session';
import { getByIata } from '@/data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_AIRPORTS = 6;

export async function POST(req: NextRequest) {
  const started = Date.now();
  let body: { userQuery?: string; sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Malformed request body.' }), { status: 400 });
  }

  const userQuery = (body.userQuery ?? '').trim();
  const sessionId = body.sessionId || 'default';
  if (!userQuery) {
    return new Response(JSON.stringify({ error: 'userQuery is required.' }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        console.log(`\n[orchestrator] === "${userQuery}" (session ${sessionId}) ===`);
        appendTurn(sessionId, 'user', userQuery);
        const session = getSession(sessionId);

        // ---- 1. Intent ------------------------------------------------------
        send('stage', { stage: 'intent', message: 'Reading the question...' });
        const intent = await parseIntent(userQuery, session.history);
        console.log('[orchestrator] intent:', JSON.stringify(intent));
        send('trace', { line: `Intent parsed by ${intent.source === 'llm' ? 'the language model' : 'the rule-based fallback'}: ${intent.action}${intent.focus ? ` / focus: ${intent.focus}` : ''}.` });

        // ---- 1b. Weight adjustments (HITL) ---------------------------------
        let weights = session.weights;
        if (intent.weightAdjustments) {
          weights = normaliseWeights({ ...weights, ...intent.weightAdjustments });
          updateSession(sessionId, { weights });
          const rendered = Object.entries(weights).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(', ');
          console.log('[orchestrator] weights adjusted ->', rendered);
          send('trace', { line: `Scoring weights adjusted: ${rendered}. Re-scoring the current selection.` });
          send('weights', weights);
        }

        // ---- 2. Resolve airports -------------------------------------------
        send('stage', { stage: 'resolve', message: 'Resolving airports...' });
        let { airports, note } = resolveAirports(intent, MAX_AIRPORTS);

        // Follow-up: fall back to whatever is already in focus.
        if (airports.length === 0 && (intent.refersToPrevious || intent.action === 'adjust_weights' || intent.action === 'explain')) {
          airports = session.focusAirports.map(getByIata).filter((a): a is NonNullable<typeof a> => a !== null);
          if (airports.length) {
            note = `Carrying over the airports already in focus: ${airports.map((a) => a.iata).join(', ')}.`;
            send('trace', { line: note });
          }
        }

        // Last resort before giving up: the rule-based extractor on the raw text.
        if (airports.length === 0) {
          const rules = rulesIntent(userQuery);
          const retry = resolveAirports(rules, MAX_AIRPORTS);
          if (retry.airports.length) {
            airports = retry.airports;
            send('trace', { line: 'Recovered the airport set with the deterministic extractor.' });
          }
        }

        if (airports.length === 0) {
          const msg = note
            ? `${note} Try naming an airport, city, country or continent - for example "compare LHR and DXB" or "which airports in Israel are worth expanding".`
            : 'I could not tell which airports you mean. Try naming an airport, city, country or continent - for example "compare LHR and DXB" or "which airports in Israel are worth expanding".';
          send('narration', { text: msg, origin: 'deterministic', guardrail: { passed: true, violations: [] } });
          appendTurn(sessionId, 'assistant', msg);
          send('done', { elapsedMs: Date.now() - started });
          controller.close();
          return;
        }

        if (note) send('trace', { line: note });
        send('stage', { stage: 'fetch', message: `Pulling live operations for ${airports.map((a) => a.iata).join(', ')}...` });

        // ---- 3. Snapshots (concurrent) --------------------------------------
        const snapshots = await Promise.all(airports.map((a) => buildSnapshot(a)));
        for (const s of snapshots) for (const line of s.trace) send('trace', { line });

        // ---- 4. Deterministic scoring ---------------------------------------
        send('stage', { stage: 'score', message: 'Running the deterministic scoring engine...' });
        const scores: InvestmentScore[] = rankAirports(
          airports.map((a, i) => scoreAirport(a, snapshots[i].snapshot, weights)),
        );
        console.log('[orchestrator] scores:', scores.map((s) => `${s.airport.iata}=${s.finalScore}(${s.confidence})`).join(' '));

        // ---- 5. Dashboard first ---------------------------------------------
        send('scores', { scores, weights });

        // ---- 6. Narration + guardrails --------------------------------------
        send('stage', { stage: 'narrate', message: 'Writing the analyst summary...' });
        const narration = await narrate(userQuery, intent, scores, summarise(session));
        console.log(`[orchestrator] narration origin=${narration.origin}${narration.model ? ` model=${narration.model}` : ''} guardrail=${narration.guardrail.passed ? 'pass' : 'FAIL'}`);

        if (!narration.guardrail.passed) {
          send('trace', { line: `Guardrails rejected the generated summary (${narration.guardrail.violations[0]}). Serving the deterministic version instead.` });
        }

        send('narration', narration);
        appendTurn(sessionId, 'assistant', narration.text);
        updateSession(sessionId, { focusAirports: scores.map((s) => s.airport.iata), lastScores: scores, weights });

        const elapsed = Date.now() - started;
        console.log(`[orchestrator] done in ${elapsed}ms\n`);
        send('done', { elapsedMs: elapsed });
        controller.close();
      } catch (err) {
        // Nothing above is allowed to reach the analyst as a stack trace.
        console.error('[orchestrator] unhandled error:', err);
        send('narration', {
          text: 'Something went wrong on our side while running that analysis. The scoring engine and the airport dataset are unaffected - try rephrasing, or name the airports directly.',
          origin: 'deterministic',
          guardrail: { passed: true, violations: [] },
        });
        send('done', { elapsedMs: Date.now() - started, error: true });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
