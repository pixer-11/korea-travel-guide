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

// 2026-10-05: Bathurst 1000 rendered with no data-tz, so its on/over state used
// the reader's date. The test above only walks countries.json regions; event
// discovery creates cities that are in no config (Bathurst, Kansas City,
// Tempe). Every published post in a multi-zone country must resolve.
test('every published post in a multi-zone country resolves to a zone', async () => {
  const { readdirSync } = await import('node:fs');
  const dir = new URL('../content/posts/', import.meta.url);
  const UNKNOWABLE = new Set(['Arlington', 'Sturgis']); // two states each — see venue-tz.mjs
  const missing = new Set();
  let seen = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const fm = readFileSync(new URL(f, dir), 'utf8').split(/\r?\n---/)[0];
    if (/^draft:\s*true/m.test(fm)) continue;
    const country = fm.match(/^country:\s*["']?([^"'\r\n]+)/m)?.[1]?.trim();
    const region = fm.match(/^region:\s*["']?([^"'\r\n]+)/m)?.[1]?.trim();
    if (!REGION_TZ[country]) continue;
    seen++;
    if (!UNKNOWABLE.has(region) && !venueTimeZone(country, region)) missing.add(`${country} / ${region}`);
  }
  assert.ok(seen > 100, `only ${seen} multi-zone posts read`);
  assert.deepEqual([...missing], [], 'add these cities to REGION_TZ in src/lib/venue-tz.mjs');
});
