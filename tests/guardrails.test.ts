import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNarration, deterministicNarration } from '../src/ai/guardrails';
import { scoreAirport } from '../src/core/scoring';

/** Stand-in for the payload the narrator sends the model. */
const payloadFor = (scores: ReturnType<typeof scoreAirport>[]) => scores.map((s) => ({
  airport: `${s.airport.name} (${s.airport.iata})`,
  finalScore: s.finalScore,
  pillars: s.pillars.map((p) => ({ name: p.label, score: p.score, weightPct: Math.round(p.weight * 100), inputs: p.inputs })),
  unmetDemandShare: s.unmetDemandShare,
}));
import { airport, snapshot, m } from './fixtures';

const LHR = scoreAirport(airport({ iata: 'LHR', name: 'London Heathrow' }), snapshot({ dailyDepartures: m(300) }));
const DXB = scoreAirport(airport({ iata: 'DXB', name: 'Dubai International' }), snapshot({ dailyDepartures: m(180) }));
const BOTH = [LHR, DXB];

test('a grounded brief passes validation', () => {
  const text = `**Recommendation**\nLondon Heathrow (LHR) scores ${LHR.finalScore}/100 and leads the field.`;
  const r = validateNarration(text, BOTH, payloadFor(BOTH));
  assert.ok(r.passed, `unexpected violations: ${r.violations.join('; ')}`);
});

test('an invented score is caught', () => {
  const r = validateNarration('London Heathrow (LHR) scores 91/100 and is the clear leader.', BOTH, payloadFor(BOTH));
  assert.equal(r.passed, false);
  assert.ok(r.violations.some((v) => v.includes('91')));
});

test('an airport that was never analysed is caught', () => {
  const r = validateNarration(`LHR at ${LHR.finalScore}/100 beats CDG comfortably.`, BOTH, payloadFor(BOTH));
  assert.equal(r.passed, false);
  assert.ok(r.violations.some((v) => v.includes('CDG')));
});

test('common English three-letter words are not mistaken for airport codes', () => {
  const r = validateNarration(`THE asset ranks well AND its network IS strong. TOP pick: LHR at ${LHR.finalScore}/100.`, BOTH, payloadFor(BOTH));
  assert.ok(r.passed, `false positives: ${r.violations.join('; ')}`);
});

test('legitimate score gaps between analysed airports are allowed', () => {
  const gap = Math.abs(LHR.finalScore - DXB.finalScore);
  // Only meaningful to assert once the gap is above the ordinal cutoff.
  if (gap > 10) {
    const r = validateNarration(`LHR leads DXB by ${gap} points.`, BOTH, payloadFor(BOTH));
    assert.ok(r.passed, `a real pairwise gap must not be rejected: ${r.violations.join('; ')}`);
  }
});

test('small integers are treated as ordinals, not factual claims', () => {
  const r = validateNarration('Three points stand out, and 2 of them concern capacity.', BOTH, payloadFor(BOTH));
  assert.ok(r.passed);
});

test('the deterministic brief has every section an analyst expects', () => {
  const text = deterministicNarration(BOTH);
  for (const heading of ['**Recommendation**', '**Why**', '**The counter-argument**', '**What would change this view**']) {
    assert.ok(text.includes(heading), `missing section: ${heading}`);
  }
  assert.ok(text.length > 400, 'the fallback must be a brief, not a headline');
});

test('the deterministic brief only ever cites its own numbers', () => {
  const r = validateNarration(deterministicNarration(BOTH), BOTH, payloadFor(BOTH));
  assert.ok(r.passed, `the fallback must pass its own guardrail: ${r.violations.join('; ')}`);
});

test('the deterministic brief names an estimate as an estimate', () => {
  const estimated = scoreAirport(airport({ iata: 'TLV' }), snapshot({
    dailyDepartures: m(264, 'structural'),
    uniqueDestinations: m(49, 'structural'),
    trafficMomentum: m(0, 'unavailable'),
  }));
  const text = deterministicNarration([estimated]);
  assert.ok(/estimate/i.test(text), 'an unobserved figure must be labelled in the prose, not only in the UI');
});

test('an empty result set does not produce a broken brief', () => {
  assert.equal(deterministicNarration([]), 'No airports matched that query in the dataset.');
});

test('the deterministic brief names the pillar that actually separates the field', () => {
  // Pins a self-contradicting sentence: the template used to assert that demand
  // pressure was the separator even when the runner-up scored higher on it.
  const hub = scoreAirport(airport({ iata: 'BOS', name: 'Boston Logan' }), snapshot({
    dailyDepartures: m(200), uniqueDestinations: m(140), longHaulShare: m(0.3), continentsServed: m(5),
  }));
  const busy = scoreAirport(airport({ iata: 'BDL', name: 'Bradley' }), snapshot({
    dailyDepartures: m(300), uniqueDestinations: m(12), longHaulShare: m(0.02), continentsServed: m(1),
  }));

  const text = deterministicNarration([hub, busy]);
  // Note the non-greedy number pattern: [\d.]+ would swallow the sentence's
  // final full stop and turn the score into NaN.
  const match = /separation comes from ([A-Za-z ]+): ([A-Z]{3}) reads (\d+(?:\.\d+)?) where ([A-Z]{3}) reads (\d+(?:\.\d+)?)/.exec(text);
  assert.ok(match, `expected a separation sentence, got:\n${text}`);
  assert.equal(match[2], 'BOS', 'the leader must be named first');
  assert.ok(
    Number(match[3]) > Number(match[5]),
    `the named separator must actually favour the leader: "${match[0]}"`,
  );
});

test('the deterministic brief never calls an excluded pillar the weakest leg', () => {
  const s = scoreAirport(airport(), snapshot({ trafficMomentum: m(0, 'unavailable') }));
  const text = deterministicNarration([s]);
  assert.ok(!/weakest leg.*Growth Momentum/i.test(text), 'a pillar carrying zero weight cannot be a weakness');
});
