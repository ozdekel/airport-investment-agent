import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreAirport, rankAirports, normaliseWeights } from '../src/core/scoring';
import { airport, snapshot, m } from './fixtures';

test('scoring is deterministic - identical inputs give identical output', () => {
  const a = airport(), s = snapshot();
  const first = scoreAirport(a, s);
  const second = scoreAirport(a, s);
  assert.deepEqual(first, second, 'the engine must never depend on clock or randomness');
});

test('final score is always bounded to 0..100', () => {
  const extremes = [
    snapshot({ dailyDepartures: m(99999), uniqueDestinations: m(9999), longHaulShare: m(1), carrierHHI: m(0), trafficMomentum: m(10), continentsServed: m(99) }),
    snapshot({ dailyDepartures: m(0), uniqueDestinations: m(0), longHaulShare: m(0), carrierHHI: m(1), dominantCarrierShare: m(1), delayShare: m(0), trafficMomentum: m(-1), continentsServed: m(0) }),
  ];
  for (const s of extremes) {
    const r = scoreAirport(airport(), s);
    assert.ok(r.finalScore >= 0 && r.finalScore <= 100, `score out of range: ${r.finalScore}`);
    for (const p of r.pillars) assert.ok(p.score >= 0 && p.score <= 100, `${p.key} out of range: ${p.score}`);
  }
});

test('a saturated airport outscores an idle one on demand pressure', () => {
  const a = airport({ runways: { count: 2, maxLengthFt: 12000, totalLengthFt: 24000, pavedCount: 2, lightedCount: 2 } });
  // 2 runways x 160 slots = 320/day capacity. 300 departures = 94% utilisation.
  const busy = scoreAirport(a, snapshot({ dailyDepartures: m(300), delayShare: m(0.30, 'enriched') }));
  const idle = scoreAirport(a, snapshot({ dailyDepartures: m(40), delayShare: m(0.02, 'enriched') }));

  const busyDemand = busy.pillars.find(p => p.key === 'demandPressure')!.score;
  const idleDemand = idle.pillars.find(p => p.key === 'demandPressure')!.score;
  assert.ok(busyDemand > idleDemand, `saturation must read as opportunity: ${busyDemand} vs ${idleDemand}`);
  assert.equal(busyDemand, 100, 'past both the saturation and delay ceilings the pillar should max out');

  // And with only the utilisation ceiling hit, the pillar should be high but not maxed.
  const busyButPunctual = scoreAirport(a, snapshot({ dailyDepartures: m(300), delayShare: m(0.10, 'enriched') }));
  const partial = busyButPunctual.pillars.find(p => p.key === 'demandPressure')!.score;
  assert.ok(partial > 70 && partial < 100, `saturated but punctual should be high, not maxed: ${partial}`);
});

test('demand pressure is about saturation, not raw volume', () => {
  // Same 300 departures, but spread over 6 runways instead of 2.
  const small = airport({ runways: { count: 2, maxLengthFt: 12000, totalLengthFt: 24000, pavedCount: 2, lightedCount: 2 } });
  const large = airport({ runways: { count: 6, maxLengthFt: 12000, totalLengthFt: 72000, pavedCount: 6, lightedCount: 6 } });
  const s = snapshot({ dailyDepartures: m(300) });

  const constrained = scoreAirport(small, s).pillars.find(p => p.key === 'demandPressure')!.score;
  const roomy = scoreAirport(large, s).pillars.find(p => p.key === 'demandPressure')!.score;
  assert.ok(constrained > roomy, 'identical traffic on more runways must read as less pressure');
});

test('carrier concentration raises a risk flag and reduces the final score', () => {
  const diversified = scoreAirport(airport(), snapshot({ carrierHHI: m(0.10), dominantCarrierShare: m(0.20) }));
  const captive = scoreAirport(airport(), snapshot({ carrierHHI: m(0.65), dominantCarrierShare: m(0.80) }));

  assert.equal(diversified.risk.flags.length, 0);
  assert.ok(captive.risk.flags.some(f => f.code === 'CARRIER_CONCENTRATION'));
  assert.ok(captive.risk.multiplier < 1, 'risk must actually bite');
  assert.ok(captive.finalScore < diversified.finalScore);
});

test('the risk penalty is capped so a risky opportunity is flagged, not buried', () => {
  const worst = scoreAirport(
    airport({ runways: { count: 1, maxLengthFt: 6000, totalLengthFt: 6000, pavedCount: 1, lightedCount: 1 } }),
    snapshot({ dominantCarrierShare: m(0.95), uniqueDestinations: m(4), dailyDepartures: m(0, 'unavailable') }),
  );
  assert.ok(worst.risk.multiplier >= 0.8, `penalty must be capped at 20%, got ${worst.risk.multiplier}`);
  assert.ok(worst.risk.flags.length >= 3, 'all applicable flags should fire');
});

test('missing live data degrades confidence instead of inventing a number', () => {
  const live = scoreAirport(airport(), snapshot());
  const blind = scoreAirport(airport(), snapshot({
    dailyDepartures: m(150, 'structural'),
    uniqueDestinations: m(30, 'structural'),
    longHaulShare: m(0.1, 'structural'),
    carrierHHI: m(0.25, 'structural'),
    delayShare: m(0, 'unavailable'),
    trafficMomentum: m(0, 'unavailable'),
    continentsServed: m(3, 'structural'),
  }));
  assert.equal(live.confidence, 'high');
  assert.ok(blind.confidence !== 'high', 'an estimate must never be presented with full confidence');
});

test('an unavailable pillar is excluded and its weight redistributed, not held at neutral', () => {
  const r = scoreAirport(airport(), snapshot({ trafficMomentum: m(0, 'unavailable') }));
  const growth = r.pillars.find(p => p.key === 'growthMomentum')!;

  assert.equal(growth.weight, 0, 'a pillar we cannot measure must not carry weight');
  assert.equal(growth.contribution, 0);
  assert.deepEqual(r.redistributedFrom, ['growthMomentum'], 'the exclusion must be reported, not silent');

  // The surviving weights must still sum to 1 and keep their relative proportions.
  const total = Object.values(r.weightsApplied).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-12, `weights must still sum to 1, got ${total}`);

  const base = scoreAirport(airport(), snapshot());
  const ratioBefore = base.weightsApplied.demandPressure / base.weightsApplied.networkGravity;
  const ratioAfter = r.weightsApplied.demandPressure / r.weightsApplied.networkGravity;
  assert.ok(Math.abs(ratioBefore - ratioAfter) < 1e-12, 'redistribution must preserve relative proportions');
});

test('excluding a pillar keeps scores discriminating rather than pulling them to the middle', () => {
  // A strong airport and a weak one, both missing the growth signal. Holding
  // growth at a neutral 50 would compress the gap between them.
  const strong = snapshot({ dailyDepartures: m(320), delayShare: m(0.30, 'enriched'), uniqueDestinations: m(140), longHaulShare: m(0.3), trafficMomentum: m(0, 'unavailable') });
  const weak = snapshot({ dailyDepartures: m(40), delayShare: m(0.01, 'enriched'), uniqueDestinations: m(8), longHaulShare: m(0.01), trafficMomentum: m(0, 'unavailable') });

  const gap = scoreAirport(airport(), strong).finalScore - scoreAirport(airport(), weak).finalScore;
  assert.ok(gap > 30, `the ranking must stay decisive when a signal is missing, gap was ${gap}`);
});

test('unmet demand combines delay and cancellation into one reportable figure', () => {
  const r = scoreAirport(airport(), snapshot({ delayShare: m(0.18, 'enriched'), cancelledShare: m(0.04) }));
  assert.ok(Math.abs(r.unmetDemandShare - 0.22) < 1e-12, `expected 22%, got ${r.unmetDemandShare}`);

  const blind = scoreAirport(airport(), snapshot({ delayShare: m(0, 'unavailable'), cancelledShare: m(0, 'unavailable') }));
  assert.equal(blind.unmetDemandShare, 0, 'with no observation it must report zero, not a guess');
});

test('chronic cancellation raises its own risk flag', () => {
  const r = scoreAirport(airport(), snapshot({ cancelledShare: m(0.09) }));
  assert.ok(r.risk.flags.some(f => f.code === 'HIGH_CANCELLATION'));
});

test('analyst weights are normalised and actually move the result', () => {
  const w = normaliseWeights({ demandPressure: 2, networkGravity: 1, revenueQuality: 1, growthMomentum: 1 });
  const total = Object.values(w).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(total - 1) < 1e-12, `weights must sum to 1, got ${total}`);
  assert.ok(Math.abs(w.demandPressure - 0.4) < 1e-12);

  const base = scoreAirport(airport(), snapshot({ dailyDepartures: m(320) }));
  const demandHeavy = scoreAirport(airport(), snapshot({ dailyDepartures: m(320) }), { demandPressure: 0.9, networkGravity: 0.04, revenueQuality: 0.03, growthMomentum: 0.03 });
  assert.notEqual(base.finalScore, demandHeavy.finalScore, 'HITL weights must be wired through');
});

test('degenerate weights fall back to defaults rather than dividing by zero', () => {
  const w = normaliseWeights({ demandPressure: 0, networkGravity: 0, revenueQuality: 0, growthMomentum: 0 });
  assert.ok(Math.abs(Object.values(w).reduce((s, v) => s + v, 0) - 1) < 1e-12);
});

test('ranking is deterministic and breaks ties stably', () => {
  const a = scoreAirport(airport({ iata: 'AAA' }), snapshot());
  const b = scoreAirport(airport({ iata: 'BBB' }), snapshot());
  const ranked = rankAirports([b, a]);
  assert.equal(ranked[0].airport.iata, 'AAA', 'identical scores must tie-break alphabetically');
  assert.deepEqual(rankAirports([b, a]), rankAirports([a, b]), 'ranking must not depend on input order');
});

test('every pillar explains itself for the audit trail', () => {
  const r = scoreAirport(airport(), snapshot());
  for (const p of r.pillars) {
    assert.ok(p.formula.length > 0, `${p.key} must expose its formula`);
    assert.ok(p.rationale.length > 0, `${p.key} must expose a rationale`);
    assert.ok(Object.keys(p.inputs).length > 0, `${p.key} must expose its inputs`);
  }
  assert.ok(r.thesis.length > 0);
});

test('an impossible departure count is capped and flagged rather than believed', () => {
  // This pins the bug that made Heathrow read 1,591% of runway capacity: the
  // provider total was not a single-day count.
  const twoRunways = airport({ runways: { count: 2, maxLengthFt: 12799, totalLengthFt: 24800, pavedCount: 2, lightedCount: 2 } });
  const absurd = scoreAirport(twoRunways, snapshot({ dailyDepartures: m(5091) }));

  assert.ok(absurd.risk.flags.some(f => f.code === 'IMPLAUSIBLE_VOLUME'), 'the reading must be challenged, not reported');
  const demand = absurd.pillars.find(p => p.key === 'demandPressure')!;
  assert.equal(demand.confidence, 'low', 'we cannot be confident in a number we do not believe');
  assert.match(String(demand.inputs.utilisation), /IMPLAUSIBLE/);
});

test('a plausible saturated airport is not flagged', () => {
  const twoRunways = airport({ runways: { count: 2, maxLengthFt: 12799, totalLengthFt: 24800, pavedCount: 2, lightedCount: 2 } });
  // 650 departures across 2 runways is ~203% of the modelled slot figure -
  // high, but below the disbelief threshold, and a real Heathrow-like number.
  const real = scoreAirport(twoRunways, snapshot({ dailyDepartures: m(650) }));
  assert.ok(!real.risk.flags.some(f => f.code === 'IMPLAUSIBLE_VOLUME'));
});

test('unmet demand still separates two equally saturated airports', () => {
  // Both are past the utilisation ceiling, so the ONLY thing that can rank them
  // is service delivery. If this collapses, the 44%-weighted pillar is a constant.
  const a = airport({ runways: { count: 2, maxLengthFt: 12000, totalLengthFt: 24000, pavedCount: 2, lightedCount: 2 } });
  const struggling = scoreAirport(a, snapshot({ dailyDepartures: m(600), delayShare: m(0.24, 'live'), cancelledShare: m(0.03) }));
  const coping = scoreAirport(a, snapshot({ dailyDepartures: m(600), delayShare: m(0.02, 'live'), cancelledShare: m(0.00) }));

  const d1 = struggling.pillars.find(p => p.key === 'demandPressure')!.score;
  const d2 = coping.pillars.find(p => p.key === 'demandPressure')!.score;
  assert.ok(d1 - d2 > 25, `unmet demand must remain a discriminating signal, gap was ${(d1 - d2).toFixed(1)}`);
});
