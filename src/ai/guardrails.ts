/**
 * Post-generation factual grounding.
 *
 * WHAT WAS WRONG ORIGINALLY: the check was `aiResponse.includes(String(score))`.
 * It fired whenever the model wrote a good summary that happened not to repeat
 * the number, and it matched "70" inside "170". It punished correct answers and
 * let real errors through.
 *
 * WHAT IT DOES NOW: validates the narration against the EXACT payload the model
 * was handed. Any figure in the text that does not appear in that payload - or
 * follow from it by a permitted operation - is a fabrication. Validating
 * against a separately reconstructed list of "allowed" numbers was the source
 * of the false positives we saw in testing: the reconstruction drifted from
 * what the model actually received.
 *
 * A violation does not produce a scary error. It swaps in a deterministic brief
 * built from the same scores, so the analyst always gets a usable answer.
 */

import { InvestmentScore } from '@/core/types';

export interface GuardrailReport {
  passed: boolean;
  violations: string[];
  allowedSample: number[];
}

/** Small integers are list ordinals and pillar counts, not factual claims. */
const ORDINAL_CEILING = 10;
const TOLERANCE = 0.51;

/** Every number that appears anywhere in the payload the model was given. */
function numbersInPayload(payload: unknown): number[] {
  const out = new Set<number>();
  const add = (n: number) => {
    if (!Number.isFinite(n)) return;
    out.add(Math.round(n * 100) / 100);
    out.add(Math.round(n * 10) / 10);
    out.add(Math.round(n));
    // A share written as 0.42 may legitimately be quoted as 42%.
    if (Math.abs(n) <= 1) { out.add(Math.round(n * 1000) / 10); out.add(Math.round(n * 100)); }
  };

  for (const match of JSON.stringify(payload).matchAll(/-?\d+(?:\.\d+)?/g)) {
    add(Number(match[0]));
  }
  return [...out];
}

/** Differences between comparable figures - "leads by 16 points" is real arithmetic. */
function permittedDerivations(scores: InvestmentScore[]): number[] {
  const out = new Set<number>();
  const pairwise = (vals: number[]) => {
    for (let i = 0; i < vals.length; i++) {
      for (let j = 0; j < vals.length; j++) {
        if (i !== j) { out.add(Math.abs(vals[i] - vals[j])); out.add(Math.round(Math.abs(vals[i] - vals[j]))); }
      }
    }
  };

  pairwise(scores.map((s) => s.finalScore));
  for (const key of ['demandPressure', 'networkGravity', 'revenueQuality', 'growthMomentum']) {
    pairwise(scores.map((s) => s.pillars.find((p) => p.key === key)?.score ?? 0));
  }
  return [...out];
}

export function validateNarration(text: string, scores: InvestmentScore[], payload: unknown): GuardrailReport {
  const allowed = [...numbersInPayload(payload), ...permittedDerivations(scores)];
  const violations: string[] = [];

  // 1. No airport may be discussed that was not analysed.
  const analysed = new Set(scores.map((s) => s.airport.iata));
  const STOP = new Set(['THE', 'AND', 'FOR', 'ALL', 'ARE', 'NOT', 'BUT', 'ITS', 'CAN', 'HAS', 'WAS', 'AIR', 'TOP', 'ONE', 'TWO', 'PER', 'KEY', 'LOW', 'NEW', 'YOY', 'HHI', 'ADS', 'API', 'GDP', 'ROI', 'IRR', 'ATC']);
  for (const code of new Set(text.match(/\b[A-Z]{3}\b/g) ?? [])) {
    if (STOP.has(code)) continue;
    if (!analysed.has(code)) violations.push(`mentions airport "${code}", which was not part of the analysed set`);
  }

  // 2. Explicit score claims must be exact.
  for (const match of text.matchAll(/(\d{1,3}(?:\.\d)?)\s*(?:\/\s*100|out of 100)/g)) {
    const n = Number(match[1]);
    if (!allowed.some((a) => Math.abs(a - n) < TOLERANCE)) {
      violations.push(`states a score of ${n}/100 that does not appear in the computed data`);
    }
  }

  // 3. Any other quantitative claim must trace back to the payload.
  for (const match of text.matchAll(/-?\d+(?:\.\d+)?/g)) {
    const n = Math.abs(Number(match[0]));
    if (n <= ORDINAL_CEILING) continue;
    if (!allowed.some((a) => Math.abs(Math.abs(a) - n) < TOLERANCE)) {
      violations.push(`uses the figure ${match[0]}, which is not present in the data it was given`);
    }
  }

  const unique = [...new Set(violations)];
  if (unique.length) console.warn('[guardrails] violations:', unique);
  else console.log('[guardrails] narration is fully grounded');

  return { passed: unique.length === 0, violations: unique, allowedSample: allowed.slice(0, 24) };
}

/**
 * The deterministic brief. Used when the LLM is unavailable OR when its output
 * fails validation.
 *
 * It follows the same four-part structure as the generated version, because a
 * fallback that is visibly a downgrade teaches the analyst to distrust the whole
 * product. Less fluent; not less useful.
 */
export function deterministicNarration(scores: InvestmentScore[], reason?: string): string {
  if (scores.length === 0) return 'No airports matched that query in the dataset.';

  const ranked = [...scores].sort((a, b) => b.finalScore - a.finalScore);
  const top = ranked[0];
  const pillarOf = (s: InvestmentScore, key: string) => s.pillars.find((p) => p.key === key)!;

  // Only pillars that actually carry weight can be described as strong or weak.
  const scoring = top.pillars.filter((p) => p.weight > 0);
  const strongest = [...scoring].sort((a, b) => b.score - a.score)[0];
  const weakest = [...scoring].sort((a, b) => a.score - b.score)[0];

  const estimated = top.snapshot.dailyDepartures.provenance === 'structural';
  const verdict =
    top.finalScore >= 70 ? 'prioritise it for diligence'
    : top.finalScore >= 50 ? 'keep it on the watchlist rather than committing'
    : 'pass for now';

  const out: string[] = [];

  out.push('**Recommendation**');
  out.push(
    `${top.airport.name} (${top.airport.iata}) scores ${top.finalScore}/100 and is the strongest candidate here - ${verdict}.` +
    (top.confidence !== 'high'
      ? ` Treat this as ${top.confidence}-confidence: ${estimated
          ? 'live flight coverage was unavailable, so its traffic figures are class-based estimates rather than observations.'
          : 'parts of the picture came from a partial sample.'}`
      : ''),
  );

  out.push('');
  out.push('**Why**');
  out.push(
    `${strongest.rationale} With ${top.airport.runways.count} runway${top.airport.runways.count === 1 ? '' : 's'} on the ground, that is the gap the capital would be closing.`,
  );

  if (ranked.length > 1) {
    const runnerUp = ranked[1];
    // Name the pillar that ACTUALLY separates the top two, rather than assuming
    // it is always demand pressure - which produced a self-contradicting
    // sentence when the runner-up scored higher on that pillar.
    const separator = scoring
      .map((p) => ({ p, gap: p.contribution - pillarOf(runnerUp, p.key).contribution }))
      .sort((a, b) => b.gap - a.gap)[0];

    const rest = ranked.slice(1).map((s) => `${s.airport.iata} at ${s.finalScore}`).join(', ');
    out.push(
      separator.gap > 0
        ? `Against the field (${rest}), the separation comes from ${separator.p.label}: ${top.airport.iata} reads ${separator.p.score} where ${runnerUp.airport.iata} reads ${pillarOf(runnerUp, separator.p.key).score}.`
        : `Against the field (${rest}), no single pillar separates the top two - ${top.airport.iata} leads on the weighted total rather than on any one dimension, which is a thin basis for preferring it.`,
    );
  }

  out.push('');
  out.push('**The counter-argument**');
  if (top.risk.flags.length > 0) {
    out.push(
      top.risk.flags.map((f) => f.message).join(' ') +
      ` A risk multiplier of x${top.risk.multiplier.toFixed(3)} is already applied to the score above.`,
    );
  } else {
    out.push(
      `The weakest leg that actually counts is ${weakest.label} at ${weakest.score}. ${weakest.rationale} ` +
      `No structural risk flags fired, which is itself worth checking against your own view of the market.`,
    );
  }

  out.push('');
  out.push('**What would change this view**');
  out.push(
    estimated
      ? 'A live traffic observation. Everything above rests on an estimate from airport class and runway count; a real departure count could move the demand pillar in either direction.'
      : top.snapshot.delayShare.provenance === 'unavailable'
      ? 'A punctuality reading. Without it the demand pillar rests on utilisation alone, and chronic on-time performance would either confirm or dissolve the congestion case.'
      : `A change in the carrier mix that concentrates revenue on fewer counterparties, or a sustained fall in ${top.airport.iata} departures below the level that produces the current saturation reading.`,
  );

  if (top.redistributedFrom.length > 0) {
    out.push('');
    out.push(
      `*${top.redistributedFrom.length} pillar could not be measured on this data tier and was excluded; its weight was redistributed across the rest rather than scored as neutral.*`,
    );
  }

  if (reason) {
    out.push('');
    out.push(`*Generated directly from the scoring engine (${reason}).*`);
  }

  return out.join('\n');
}
