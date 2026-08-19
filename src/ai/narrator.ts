/**
 * The output half of the AI layer: turns computed scores into an analyst brief.
 *
 * DESIGN NOTE: the first version of this asked for "4-5 short sentences" and got
 * exactly what it asked for - "Top candidate: LHR, 60." That is a headline, not
 * analysis. An analyst reading a screen full of pillar bars does not need the
 * numbers repeated back; they need the CAUSAL STORY that connects them, and a
 * recommendation they can act on or argue with.
 *
 * So the model is now asked for a structured brief: what to do, why the numbers
 * say that, what would break the thesis, and what would change our mind. It is
 * still forbidden from doing arithmetic - it is a writer with a strong brief,
 * not a calculator.
 */

import { chat } from './client';
import { InvestmentScore } from '@/core/types';
import { validateNarration, deterministicNarration } from './guardrails';
import { AnalystIntent } from './intent';

const SYSTEM = `You are a senior aviation infrastructure analyst writing a short investment brief for a colleague who will act on it. You are not a chatbot and you are not summarising a dashboard - the numbers are already on their screen. Your job is to tell them WHAT IT MEANS and WHAT TO DO.

THE THESIS YOU WORK FROM
A good expansion candidate is an airport where DEMAND HAS OUTRUN INFRASTRUCTURE. Saturation, congestion and delay are the OPPORTUNITY - they are the market's own evidence that capacity is short and that new capacity has a waiting customer. A quiet, punctual airport with spare runway is a WEAK candidate however pleasant it is to fly through. Never congratulate an airport for being uncongested.

STRUCTURE - use these exact markdown headings, in this order:

**Recommendation**
One or two sentences. Name the airport, its score, and what the analyst should actually do: prioritise it for diligence, put it on a watchlist, or pass. Be decisive.

**Why**
Three to five sentences of causal reasoning. This is the core of the brief. Do not list pillar scores - explain the mechanism. Connect the physical facts (runways, departures, destinations, carrier mix) to the investment consequence. A good sentence looks like: "Two runways absorbing 431 departures a day puts it 35% past the point where queueing starts, and the 22% delay rate is the market pricing that shortage." A bad sentence looks like: "Demand Pressure scored 100."

**The counter-argument**
Two to three sentences. The strongest honest case against this recommendation - the risk flag, the concentration exposure, the structural constraint, or the weak pillar. An analyst who only hears the bull case stops trusting you.

**What would change this view**
One or two sentences. The specific observation that would flip the recommendation. This is what separates a view from a number.

WHEN COMPARING MULTIPLE AIRPORTS
Rank them explicitly and explain the separation - why the leader leads, and what the runner-up would need for that to reverse. Do not describe each airport in isolation.

HARD RULES
1. Every figure you write must appear verbatim in the JSON provided. Never calculate, average, sum, subtract or estimate. If you want to say one airport leads another by some margin, say "leads" without inventing the gap.
2. Never mention an airport that is not in the JSON.
3. Where a metric's provenance is "structural", it is an ESTIMATE derived from airport class, not an observation. Say so plainly - "on estimated traffic, since live coverage was unavailable". Never present an estimate as a measurement.
4. Where overall confidence is medium or low, the Recommendation must be hedged accordingly.
5. Write like a colleague briefing a colleague. No "exciting opportunity", no "robust growth potential", no "in today's dynamic aviation landscape". Plain, direct, specific.
6. Total length 180-280 words. Long enough to say something, short enough to read.`;

/** Trims the payload to what the narrator needs, and spells out data quality. */
function toPayload(scores: InvestmentScore[]) {
  return scores.map((s) => ({
    airport: `${s.airport.name} (${s.airport.iata})`,
    country: s.airport.country,
    continent: s.airport.continent,
    runways: s.airport.runways.count,
    longestRunwayFt: s.airport.runways.maxLengthFt,
    finalScore: s.finalScore,
    overallConfidence: s.confidence,
    unmetDemandSharePct: `${(s.unmetDemandShare * 100).toFixed(0)}% of departures delayed or cancelled`,
    pillarsExcludedForMissingData: s.redistributedFrom,
    thesis: s.thesis,
    pillars: s.pillars.map((p) => ({
      name: p.label,
      score: p.score,
      weightPct: Math.round(p.weight * 100),
      inputs: p.inputs,
      whatItMeans: p.rationale,
      confidence: p.confidence,
    })),
    riskFlags: s.risk.flags.map((f) => ({ severity: f.severity, message: f.message })),
    riskMultiplier: s.risk.multiplier,
    dataQuality: {
      departuresPerDay: `${s.snapshot.dailyDepartures.value} (${s.snapshot.dailyDepartures.provenance === 'structural' ? 'ESTIMATED from airport class - not observed' : s.snapshot.dailyDepartures.provenance})`,
      destinations: `${s.snapshot.uniqueDestinations.value} (${s.snapshot.uniqueDestinations.provenance === 'structural' ? 'ESTIMATED' : s.snapshot.uniqueDestinations.provenance})`,
      longHaulShare: `${(s.snapshot.longHaulShare.value * 100).toFixed(0)}% (${s.snapshot.longHaulShare.provenance === 'structural' ? 'ESTIMATED' : s.snapshot.longHaulShare.provenance})`,
      delaySignal: s.snapshot.delayShare.provenance === 'unavailable' ? 'UNAVAILABLE' : `${(s.snapshot.delayShare.value * 100).toFixed(0)}% (${s.snapshot.delayShare.provenance})`,
      cancellationSignal: s.snapshot.cancelledShare.provenance === 'unavailable' ? 'UNAVAILABLE' : `${(s.snapshot.cancelledShare.value * 100).toFixed(0)}% (${s.snapshot.cancelledShare.provenance})`,
      growthSignal: s.snapshot.trafficMomentum.provenance === 'unavailable' ? 'UNAVAILABLE - pillar held at neutral 50' : `${(s.snapshot.trafficMomentum.value * 100).toFixed(0)}% (${s.snapshot.trafficMomentum.provenance})`,
    },
  }));
}

export interface NarrationResult {
  text: string;
  origin: 'llm' | 'deterministic';
  model?: string;
  guardrail: { passed: boolean; violations: string[] };
}

export async function narrate(
  userQuery: string,
  intent: AnalystIntent,
  scores: InvestmentScore[],
  conversationSummary: string,
): Promise<NarrationResult> {
  if (scores.length === 0) {
    return { text: deterministicNarration(scores), origin: 'deterministic', guardrail: { passed: true, violations: [] } };
  }

  const focusHint = intent.focus
    ? `\n\nThe analyst specifically asked about ${intent.focus}. Lead the "Why" section with that, but still deliver the full brief.`
    : '';
  const contextHint = conversationSummary ? `\n\nEarlier in this session you ${conversationSummary}.` : '';

  const anyEstimated = scores.some((s) => s.snapshot.dailyDepartures.provenance === 'structural');
  const dataWarning = anyEstimated
    ? '\n\nIMPORTANT: live flight coverage was unavailable for at least one of these airports, so its traffic figures are class-based estimates. Your Recommendation must be hedged and the estimate must be named as such.'
    : '';

  // Built once and passed to the guardrails, so validation happens against the
  // exact numbers the model saw rather than a reconstruction that can drift.
  const payload = toPayload(scores);

  const res = await chat({
    role: 'reasoning',
    system: SYSTEM,
    user: `Analyst question: "${userQuery}"${focusHint}${contextHint}${dataWarning}\n\nComputed data - the ONLY permitted source of figures:\n${JSON.stringify(payload, null, 2)}`,
    temperature: 0.3,
    // Generous: reasoning-capable models spend part of this budget on internal
    // tokens, and a brief truncated mid-sentence is worse than no brief.
    maxTokens: 2000,
    timeoutMs: 40000,
    label: 'llm:narrate',
  });

  if (!res.ok) {
    console.warn(`[narrator] LLM unavailable (${res.reason}) - serving the deterministic brief`);
    return {
      text: deterministicNarration(scores, 'the language model was unreachable'),
      origin: 'deterministic',
      guardrail: { passed: true, violations: [] },
    };
  }

  const check = validateNarration(res.text, scores, payload);
  if (!check.passed) {
    return {
      text: deterministicNarration(scores, 'the generated brief failed factual validation'),
      origin: 'deterministic',
      model: res.model,
      guardrail: { passed: false, violations: check.violations },
    };
  }

  return { text: res.text, origin: 'llm', model: res.model, guardrail: { passed: true, violations: [] } };
}
