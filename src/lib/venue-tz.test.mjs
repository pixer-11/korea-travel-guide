import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COUNTRY_TZ, REGION_TZ, venueTimeZone } from './venue-tz.mjs';

const countries = JSON.parse(readFileSync(new URL('../../data/countries.json', import.meta.url), 'utf8')).countries;

const valid = (tz) => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
};

test('every active country has a zone, or a per-city table', () => {
  for (const c of countries.filter((x) => x.active)) {
    assert.ok(COUNTRY_TZ[c.name] || REGION_TZ[c.name], `${c.name} has no timezone`);
  }
});

test('multi-zone countries place every configured region', () => {
  for (const c of countries.filter((x) => REGION_TZ[x.name])) {
    for (const r of c.regions) assert.ok(REGION_TZ[c.name][r], `${c.name} / ${r} has no timezone`);
  }
});

test('every zone is a real IANA zone', () => {
  for (const tz of [...Object.values(COUNTRY_TZ), ...Object.values(REGION_TZ).flatMap((m) => Object.values(m))]) {
    assert.ok(valid(tz), tz);
  }
});

test('unknown city in a multi-zone country is null, never a guess', () => {
  assert.equal(venueTimeZone('United States', 'Arlington'), null);
  assert.equal(venueTimeZone('United States', 'Seattle'), 'America/Los_Angeles');
  assert.equal(venueTimeZone('Indonesia', 'Bali'), 'Asia/Makassar');
  assert.equal(venueTimeZone('Japan', 'Tokyo'), 'Asia/Tokyo');
  assert.equal(venueTimeZone('Atlantis', 'X'), null);
});
