// The coordinates-inside-country guard (lib/guardrails.mjs).
//   node --test scripts/lib/guardrails.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkPlace, insideCountry } from './guardrails.mjs';

const good = { name: 'X', rating: 4.6, userRatingsTotal: 500, businessStatus: 'OPERATIONAL' };

// 2026-10-05: four countries joined after the boxes were drawn and their
// guard silently passed everything. The next country must break CI instead.
test('every country we publish has a box', () => {
  const boxes = JSON.parse(readFileSync(new URL('../../data/country-bbox.json', import.meta.url), 'utf8'));
  const countries = JSON.parse(readFileSync(new URL('../../data/countries.json', import.meta.url), 'utf8')).countries;
  assert.deepEqual(countries.map((c) => c.name).filter((n) => !boxes[n]), []);
});

test('a place outside its country is refused (the Petra-as-Hong-Kong case)', () => {
  const r = checkPlace({ ...good, lat: 30.33, lng: 35.44 }, { country: 'Hong Kong' });
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(), /outside Hong Kong/);
  assert.equal(checkPlace({ ...good, lat: 52.52, lng: 13.40 }, { country: 'Germany' }).ok, true);
  assert.equal(insideCountry('Mexico', 19.43, -99.13), true);
  assert.equal(insideCountry('Australia', 51.5, -0.12), false);
});

test('a country with no box fails closed', () => {
  const r = checkPlace({ ...good, lat: 1, lng: 1 }, { country: 'Atlantis' });
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(), /no bbox for Atlantis/);
});
