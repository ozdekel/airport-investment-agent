import test from 'node:test';
import assert from 'node:assert/strict';
import { findRegion, MARKET_REGIONS } from '../src/data/regions';

test('New England resolves - the exact question the brief asks about', () => {
  const r = findRegion('New England');
  assert.ok(r, 'New England must resolve; it is neither a country nor a continent');
  assert.ok(r.airports.includes('BOS'), 'Boston must be in the set');
  assert.equal(r.airports[0], 'BOS', 'the largest asset should lead the list');
  assert.ok(r.airports.length >= 4);
});

test('region matching is case and whitespace insensitive', () => {
  for (const q of ['new england', 'NEW ENGLAND', '  New   England  ']) {
    assert.ok(findRegion(q), `failed to resolve "${q}"`);
  }
});

test('aliases resolve to the same region object', () => {
  assert.equal(findRegion('nordics')?.name, 'Scandinavia');
  assert.equal(findRegion('gcc')?.name, 'Gulf');
});

test('an unknown region returns null rather than guessing', () => {
  assert.equal(findRegion('Atlantis'), null);
});

test('every region is auditable - codes are well-formed and the grouping is documented', () => {
  for (const r of MARKET_REGIONS) {
    assert.ok(r.definition.length > 20, `${r.name} needs a definition an analyst can check`);
    assert.ok(r.airports.length > 0);
    for (const code of r.airports) {
      assert.match(code, /^[A-Z]{3}$/, `${r.name} has a malformed code: ${code}`);
    }
    assert.equal(new Set(r.airports).size, r.airports.length, `${r.name} has duplicate codes`);
  }
});
