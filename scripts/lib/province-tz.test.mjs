// province-tz: a discovered city's zone from its province (2026-11-05).
// Both directions — the ten cities the hand table missed are placed, and a
// province that does not settle the clock leaves the zone empty, never guessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROVINCE_TZ, provinceOf, zoneFromProvince, sameClock, learnVenueZone, readLearned } from './province-tz.mjs';
import { REGION_TZ } from '../../src/lib/venue-tz.mjs';

const valid = (tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };

test('every multi-zone country has a province table, and every zone in it is real', () => {
  for (const c of Object.keys(REGION_TZ)) assert.ok(PROVINCE_TZ[c], `${c} spans zones but has no province table`);
  for (const [c, m] of Object.entries(PROVINCE_TZ)) {
    for (const [p, z] of Object.entries(m)) for (const tz of [z].flat()) assert.ok(valid(tz), `${c} / ${p}: ${tz}`);
  }
});

// What discovery would have said for each city the hand table missed, and the
// zone the hand table gave it afterwards.
test('the ten cities that broke the test are placed on the clock they were given by hand', () => {
  const cases = [
    ['United States', 'Gardena', 'California', 'America/Los_Angeles'],
    ['Indonesia', 'Mandalika', 'West Nusa Tenggara', 'Asia/Makassar'],
    ['United States', 'Kansas City', 'Missouri', 'America/Chicago'],
    ['United States', 'Tempe', 'Arizona', 'America/Phoenix'],
    ['Australia', 'Bathurst', 'New South Wales', 'Australia/Sydney'],
    ['United States', 'Indian Wells', 'California', 'America/Los_Angeles'],
    ['Indonesia', 'Magelang', 'Central Java', 'Asia/Jakarta'],
    ['Mongolia', 'Batnorov', 'Khentii', 'Asia/Ulaanbaatar'],
    ['Indonesia', 'Bintan', 'Riau Islands', 'Asia/Jakarta'],
    ['Indonesia', 'Jembrana', 'Bali', 'Asia/Makassar'],
  ];
  for (const [country, city, province, said] of cases) {
    const { tz, why } = zoneFromProvince(country, province, said);
    assert.ok(tz, `${city}: ${why}`);
    assert.ok(sameClock(tz, REGION_TZ[country][city]), `${city}: ${tz} vs hand ${REGION_TZ[country][city]}`);
  }
});

test('a province that does not settle the clock leaves it empty', () => {
  // The Badung trap: the search put a Bali venue in East Java's clock, or the
  // province is wrong — either way the two disagree and nothing is written.
  assert.equal(zoneFromProvince('Indonesia', 'East Java', 'Asia/Makassar').tz, null);
  assert.equal(zoneFromProvince('Indonesia', 'Bali', 'Asia/Jakarta').tz, null);
  // Spans two zones and the search named none, or one that is not the state's.
  assert.equal(zoneFromProvince('United States', 'Texas', null).tz, null);
  assert.equal(zoneFromProvince('United States', 'Arizona', 'Asia/Tokyo').tz, null);
  assert.equal(zoneFromProvince('United States', 'Arizona', 'America/Los_Angeles').tz, null);
  // No province, or one that is not in the country.
  assert.equal(zoneFromProvince('Indonesia', null, 'Asia/Makassar').tz, null);
  assert.equal(zoneFromProvince('Indonesia', 'Selangor', 'Asia/Kuala_Lumpur').tz, null);
  assert.equal(zoneFromProvince('Mongolia', 'Khovd', 'Asia/Ulaanbaatar').tz, null);
  // Provinces with a corner on another clock (zone1970.tab, Codex 11-05) need the zone named.
  assert.equal(zoneFromProvince('Canada', 'Quebec', null).tz, null);
  assert.equal(zoneFromProvince('Canada', 'Quebec', 'America/Montreal').tz, 'America/Toronto');
  assert.equal(zoneFromProvince('Canada', 'Quebec', 'America/Blanc-Sablon').tz, 'America/Puerto_Rico');
  assert.equal(zoneFromProvince('Australia', 'Tasmania', 'Antarctica/Macquarie').tz, 'Antarctica/Macquarie');
  // A province on one clock decides even with no zone named; a split one with the right one named is placed.
  assert.equal(zoneFromProvince('Indonesia', 'Bali', undefined).tz, 'Asia/Makassar');
  assert.equal(zoneFromProvince('United States', 'Texas', 'America/Denver').tz, 'America/Denver');
  // A zone named in the state's own list is kept; another name for the same clock maps onto the list.
  assert.equal(zoneFromProvince('United States', 'Michigan', 'America/New_York').tz, 'America/New_York');
  assert.equal(zoneFromProvince('United States', 'Ohio', 'America/Detroit').tz, 'America/New_York');
});

test('provinces are found under the names searches give them', () => {
  const same = [
    ['Indonesia', 'DKI Jakarta', 'Jakarta'], ['Indonesia', 'Special Region of Yogyakarta', 'Yogyakarta'],
    ['Indonesia', 'Bali Province', 'Bali'], ['Indonesia', 'Kepulauan Riau', 'Riau Islands'],
    ['United States', 'TX', 'Texas'], ['United States', 'Washington, D.C.', 'District of Columbia'],
    ['United States', 'Washington State', 'Washington'], ['United States', 'New York State', 'New York'],
    ['Mexico', 'Nuevo León', 'Nuevo Leon'], ['Mexico', 'Mexico City', 'Mexico City'], ['Mexico', 'State of Mexico', 'State of Mexico'],
    ['Mexico', 'Estado de México', 'State of Mexico'], ['Mexico', 'Yucatán', 'Yucatan'],
    ['Mongolia', 'Ömnögovi', 'Omnogovi'], ['Mongolia', 'Bayan-Ölgii Province', 'Bayan-Olgii'], ['Mongolia', 'Khentii Province', 'Khentii'],
    ['Australia', 'NSW', 'New South Wales'], ['Canada', 'Québec', 'Quebec'],
  ];
  for (const [c, raw, want] of same) assert.equal(provinceOf(c, raw), want, `${c}: ${raw}`);
  assert.equal(provinceOf('Japan', 'Tokyo'), null); // single-zone countries have no table
});

test('learnVenueZone records a new city once, keeps known ones out, and writes a loadable module', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tzlearn-'));
  const file = join(dir, 'learned.mjs');
  writeFileSync(file, 'export default {};\n');
  const quiet = { file, log: () => {} };
  try {
    assert.deepEqual(learnVenueZone('Indonesia', 'Kuta Mandalika', 'West Nusa Tenggara', 'Asia/Makassar', quiet), { tz: 'Asia/Makassar', province: 'West Nusa Tenggara' });
    assert.equal(learnVenueZone('Indonesia', 'Kuta Mandalika', 'Bali', 'Asia/Jakarta', quiet), null, 'second sighting changes nothing');
    assert.equal(learnVenueZone('Indonesia', 'Jembrana', 'Bali', null, quiet), null, 'hand table already places it');
    assert.equal(learnVenueZone('Japan', 'Sapporo', 'Hokkaido', 'Asia/Tokyo', quiet), null, 'one-zone country');
    const gap = learnVenueZone('United States', 'Springfield', 'Texas', null, quiet);
    assert.equal(gap.tz, null);
    assert.match(gap.why, /spans/);
    // The names placed nowhere on purpose stay that way, whatever the newest post says.
    assert.equal(learnVenueZone('United States', 'Arlington', 'Texas', 'America/Chicago', quiet), null);
    // Same name, another state, another clock: placed nowhere from then on.
    learnVenueZone('United States', 'Springfield', 'Illinois', 'America/Chicago', { file, log: () => {} });
    assert.equal(readLearned(file)['United States'].Springfield.tz, null, 'Texas first, no zone; Illinois may be another place — still none');
    learnVenueZone('United States', 'Springfield', 'Texas', 'America/Chicago', quiet);
    assert.equal(readLearned(file)['United States'].Springfield.tz, 'America/Chicago', 'back in Texas with its zone — placed');
    learnVenueZone('United States', 'Salem', 'Oregon', 'America/Los_Angeles', quiet);
    assert.equal(learnVenueZone('United States', 'Salem', 'Oregon', 'America/Los_Angeles', quiet), null, 'the same place again');
    const two = learnVenueZone('United States', 'Salem', 'Massachusetts', 'America/New_York', quiet);
    assert.equal(two.tz, null);
    assert.match(two.why, /two places by this name: Oregon .* Massachusetts/);
    const mod = (await import(`file:///${file.replace(/\\/g, '/')}?v=1`)).default;
    assert.deepEqual(mod, readLearned(file));
    assert.equal(mod.Indonesia['Kuta Mandalika'].tz, 'Asia/Makassar');
    assert.ok(Object.hasOwn(mod['United States'], 'Springfield'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
