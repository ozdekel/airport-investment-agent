import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveFromFlights, estimateRichness, ObservedFlight } from '../src/core/derive';
import { AirportProfile } from '../src/core/types';
import { airport, REAL } from './fixtures';

const LHR = airport({ iata: 'LHR', icao: 'EGLL', ...REAL.LHR });

const WORLD: Record<string, AirportProfile> = {
  CDG: airport({ iata: 'CDG', icao: 'LFPG', continent: 'Europe', ...REAL.CDG }),
  JFK: airport({ iata: 'JFK', icao: 'KJFK', continent: 'North America', ...REAL.JFK }),
  SIN: airport({ iata: 'SIN', icao: 'WSSS', continent: 'Asia', ...REAL.SIN }),
};
const lookup = (code: string) => WORLD[code] ?? null;

const T0 = Date.parse('2026-08-18T06:00:00Z');
const min = (n: number) => n * 60_000;

/** destination, carrier, operated, cancelled, and optional timestamps. */
const f = (
  destination: string | null,
  carrier: string | null,
  operated = true,
  cancelled = false,
  times: { scheduledMs?: number | null; actualMs?: number | null } = {},
): ObservedFlight => ({
  destination, carrier, operated, cancelled,
  scheduledMs: times.scheduledMs ?? null,
  actualMs: times.actualMs ?? null,
});

/** n flights evenly spaced across `spanHours`, all on time. */
const evenlySpaced = (n: number, spanHours: number): ObservedFlight[] =>
  Array.from({ length: n }, (_, i) =>
    f('CDG', 'BA', true, false, {
      scheduledMs: T0 + (i * spanHours * 3_600_000) / (n - 1),
      actualMs: T0 + (i * spanHours * 3_600_000) / (n - 1),
    }));

test('long-haul share uses real great-circle distance, not a hardcoded constant', () => {
  const d = deriveFromFlights(LHR, [f('CDG', 'BA'), f('CDG', 'BA'), f('JFK', 'BA'), f('SIN', 'BA')], lookup);
  // CDG is 348km (short); JFK 5555km and SIN 10866km are both beyond 4000km.
  assert.equal(d.longHaulShare, 0.5);
  assert.equal(d.continents, 3);
});

test('unresolvable destinations still count but are excluded from long-haul', () => {
  const d = deriveFromFlights(LHR, [f('JFK', 'BA'), f('ZZZ', 'BA'), f('YYY', 'BA')], lookup);
  assert.equal(d.destinationsObserved, 3);
  assert.equal(d.longHaulShare, 1, 'computed over the one resolvable destination only');
  assert.ok(Math.abs(d.resolvedShare - 1 / 3) < 1e-12);
});

test('carrier concentration is measured, not assumed', () => {
  const monopoly = deriveFromFlights(LHR, Array.from({ length: 10 }, () => f('CDG', 'BA')), lookup);
  assert.equal(monopoly.hhi, 1);
  assert.equal(monopoly.dominantShare, 1);

  const mixed = deriveFromFlights(LHR, [f('CDG', 'BA'), f('CDG', 'AF'), f('CDG', 'LH'), f('CDG', 'KL')], lookup);
  assert.ok(Math.abs(mixed.hhi - 0.25) < 1e-12);
});

test('punctuality is measured only over flights that actually operated and are timed', () => {
  // The bug this pins: including not-yet-departed flights in the denominator
  // reported Heathrow at 0% delayed.
  const flights = [
    f('CDG', 'BA', true, false, { scheduledMs: T0, actualMs: T0 + min(40) }),  // 40 min late
    f('CDG', 'BA', true, false, { scheduledMs: T0, actualMs: T0 + min(3) }),   // on time
    f('JFK', 'BA', false, false, { scheduledMs: T0 }),  // still scheduled
    f('JFK', 'BA', false, false, { scheduledMs: T0 }),
    f('SIN', 'BA', false, false, { scheduledMs: T0 }),
  ];
  const d = deriveFromFlights(LHR, flights, lookup);
  assert.equal(d.operatedCount, 2);
  assert.equal(d.punctualitySample, 2);
  assert.equal(d.delayShare, 0.5, 'must be 1 of 2 timed departures, not 1 of 5 sampled');
});

test('delay is computed from timestamps, since the provider delay field is empty', () => {
  const d = deriveFromFlights(LHR, [
    f('CDG', 'BA', true, false, { scheduledMs: T0, actualMs: T0 + min(16) }),  // just over
    f('CDG', 'BA', true, false, { scheduledMs: T0, actualMs: T0 + min(14) }),  // just under
    f('JFK', 'BA', true, false, { scheduledMs: T0, actualMs: T0 - min(5) }),   // early
  ], lookup);
  assert.ok(Math.abs(d.delayShare - 1 / 3) < 1e-12, 'the 15-minute threshold must be strict');
});

test('operated flights without timestamps are excluded from punctuality, not counted on time', () => {
  const d = deriveFromFlights(LHR, [
    f('CDG', 'BA', true, false, { scheduledMs: T0, actualMs: T0 + min(30) }),
    f('CDG', 'BA', true),  // operated but untimed - this is the Heathrow case
    f('CDG', 'BA', true),
  ], lookup);
  assert.equal(d.punctualitySample, 1);
  assert.equal(d.delayShare, 1, 'untimed flights must not dilute the rate to 0.33');
});

// ---- daily rate from the sample window ------------------------------------

test('the daily rate is inferred from the sample time span, not a provider total', () => {
  // 100 departures across 3.7 hours is Heathrow-shaped: ~642 per day.
  const d = deriveFromFlights(LHR, evenlySpaced(100, 3.7), lookup);
  assert.equal(d.observedWindowHours, 3.7);
  assert.ok(d.departuresPerDay !== null);
  assert.ok(Math.abs(d.departuresPerDay! - 642) <= 2, `expected ~642/day, got ${d.departuresPerDay}`);
});

test('a plausible small airport extrapolates to a plausible rate', () => {
  // 100 departures spread across a full operating day.
  const d = deriveFromFlights(LHR, evenlySpaced(100, 16), lookup);
  assert.ok(Math.abs(d.departuresPerDay! - 149) <= 2, `expected ~149/day, got ${d.departuresPerDay}`);
});

test('too short a window is refused rather than extrapolated wildly', () => {
  // 100 departures in 6 minutes would extrapolate to 24,000 a day.
  const d = deriveFromFlights(LHR, evenlySpaced(100, 0.1), lookup);
  assert.equal(d.departuresPerDay, null, 'the caller must be told the rate is unknown');
});

test('too few timestamped flights is refused', () => {
  const d = deriveFromFlights(LHR, evenlySpaced(5, 4), lookup);
  assert.equal(d.departuresPerDay, null);
});

test('flights with no timestamps at all leave the rate unknown, never zero', () => {
  const d = deriveFromFlights(LHR, Array.from({ length: 50 }, () => f('CDG', 'BA')), lookup);
  assert.equal(d.departuresPerDay, null);
  assert.equal(d.observedWindowHours, 0);
});

test('cancellation share is measured over flights whose outcome is known', () => {
  const d = deriveFromFlights(LHR, [
    f('CDG', 'BA', true), f('CDG', 'BA', true), f('JFK', 'BA', false, true),
    f('SIN', 'BA', false), f('SIN', 'BA', false),
  ], lookup);
  // 2 operated + 1 cancelled = 3 decided outcomes; the 2 still-scheduled are excluded.
  assert.ok(Math.abs(d.cancelledShare - 1 / 3) < 1e-12);
});

test('with nothing yet operated, punctuality reports zero and the caller can tell', () => {
  const d = deriveFromFlights(LHR, [f('CDG', 'BA', false), f('JFK', 'BA', false)], lookup);
  assert.equal(d.operatedCount, 0);
  assert.equal(d.punctualitySample, 0);
  assert.equal(d.delayShare, 0);
});

test('an empty window yields zeros or an explicit null, never NaN', () => {
  const d = deriveFromFlights(LHR, [], lookup);
  for (const [k, v] of Object.entries(d)) {
    // departuresPerDay is deliberately nullable: "we do not know the rate" is a
    // different statement from "the rate is zero", and the caller must be able
    // to tell them apart.
    if (k === 'departuresPerDay') { assert.equal(v, null); continue; }
    assert.ok(Number.isFinite(v), `${k} must be finite, got ${v}`);
  }
  assert.equal(d.hhi, 0, 'no carriers must not read as a monopoly');
});

// ---- Chao1 -----------------------------------------------------------------

test('Chao1 leaves a fully-observed sample alone', () => {
  // No singletons means the sample saturated the population.
  assert.equal(estimateRichness([5, 4, 3, 2]), 4);
  assert.equal(estimateRichness([]), 0);
});

test('Chao1 projects unseen destinations from the singleton count', () => {
  // 10 destinations, 6 seen once, 2 seen twice: 10 + 36/4 = 19.
  const counts = [1, 1, 1, 1, 1, 1, 2, 2, 5, 5];
  assert.equal(estimateRichness(counts), 19);
});

test('Chao1 handles the no-doubleton case without dividing by zero', () => {
  // f2 = 0 falls back to f1(f1-1)/2: 4 + 4*3/2 = 10.
  assert.equal(estimateRichness([1, 1, 1, 1]), 10);
});

test('Chao1 is monotonic in the singleton count - a shallower sample projects more', () => {
  const shallow = estimateRichness([1, 1, 1, 1, 1, 1, 2, 2]);
  const deep = estimateRichness([1, 4, 6, 8, 9, 11, 2, 2]);
  assert.ok(shallow > deep, 'more singletons must imply more unseen destinations');
});

test('the derived destination estimate is never below what was observed', () => {
  const d = deriveFromFlights(LHR, [f('CDG', 'BA'), f('JFK', 'BA'), f('SIN', 'BA')], lookup);
  assert.equal(d.destinationsObserved, 3);
  assert.ok(d.destinationsEstimated >= d.destinationsObserved, 'Chao1 is a lower bound on true richness');
});
