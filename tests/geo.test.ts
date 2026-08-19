import test from 'node:test';
import assert from 'node:assert/strict';
import { greatCircleKm, herfindahl, normalise, logNormalise, clamp } from '../src/core/geo';
import { REAL } from './fixtures';

test('greatCircleKm matches known real-world distances within 1%', () => {
  const cases: Array<[string, number, number]> = [
    ['LHR-CDG', greatCircleKm(REAL.LHR, REAL.CDG), 348],
    ['LHR-JFK', greatCircleKm(REAL.LHR, REAL.JFK), 5555],
    ['TLV-JFK', greatCircleKm(REAL.TLV, REAL.JFK), 9118],
    ['LHR-SIN', greatCircleKm(REAL.LHR, REAL.SIN), 10866],
  ];
  for (const [label, actual, expected] of cases) {
    const errorPct = Math.abs(actual - expected) / expected;
    assert.ok(errorPct < 0.01, `${label}: got ${actual.toFixed(0)}km, expected ~${expected}km (${(errorPct * 100).toFixed(2)}% off)`);
  }
});

test('greatCircleKm is symmetric and zero for identical points', () => {
  assert.equal(greatCircleKm(REAL.LHR, REAL.LHR), 0);
  const a = greatCircleKm(REAL.TLV, REAL.SIN);
  const b = greatCircleKm(REAL.SIN, REAL.TLV);
  assert.ok(Math.abs(a - b) < 1e-9, 'distance must be symmetric');
});

test('herfindahl: monopoly is 1, n equal actors are 1/n, empty is 0', () => {
  assert.equal(herfindahl([100]), 1);
  assert.ok(Math.abs(herfindahl([25, 25, 25, 25]) - 0.25) < 1e-12);
  assert.equal(herfindahl([]), 0);
  // An empty distribution must NOT look like perfect diversification.
  assert.equal(herfindahl([0, 0]), 0);
});

test('normalise clamps at both ends and survives a degenerate band', () => {
  assert.equal(normalise(5, 0, 10), 0.5);
  assert.equal(normalise(-5, 0, 10), 0);
  assert.equal(normalise(50, 0, 10), 1);
  assert.equal(normalise(5, 3, 3), 0, 'degenerate band must not divide by zero');
});

test('logNormalise rewards early increments more than late ones', () => {
  const early = logNormalise(30, 150) - logNormalise(10, 150);
  const late = logNormalise(170, 150) - logNormalise(150, 150);
  assert.ok(early > late, 'going 10->30 destinations must matter more than 150->170');
  assert.equal(logNormalise(0, 150), 0);
  assert.ok(logNormalise(1000, 150) <= 1, 'must saturate at 1');
});

test('clamp respects custom bounds', () => {
  assert.equal(clamp(150, 0, 100), 100);
  assert.equal(clamp(-1, 0, 100), 0);
});
