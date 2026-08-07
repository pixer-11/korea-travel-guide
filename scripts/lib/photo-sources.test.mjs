import test from 'node:test';
import assert from 'node:assert/strict';
import { distinctiveTokens, pickVenueHit } from './photo-sources.mjs';

// ── The 2026-08-07 quarantine incident, verbatim ─────────────────────────────
// "The Island Bangkok – Top Rated Thai Restaurant & Bar" (GSC rank 4.7, 304
// impressions) took the hero of "Baan Sabai Thai Massage" 71m away because
// 'thai' counted as a distinctive token. The massage shop must never match,
// and the venue's real (shorter) Foursquare name must still match.
const ISLAND = 'The Island Bangkok – Top Rated Thai Restaurant & Bar';
const BKK = 'Bangkok, Thailand';

test('nationality adjective alone cannot match a neighboring business', () => {
  const hit = pickVenueHit(ISLAND, BKK, [
    { name: 'Baan Sabai Thai Massage', distance: 71 },
  ]);
  assert.equal(hit, null);
});

test('the venue\'s short Foursquare registered name still matches', () => {
  const hit = pickVenueHit(ISLAND, BKK, [
    { name: 'Baan Sabai Thai Massage', distance: 71 },
    { name: 'The Island Restaurant (ก๋วยเตี๋ยว จุ่ม)', distance: 12 },
  ]);
  assert.equal(hit?.name, 'The Island Restaurant (ก๋วยเตี๋ยว จุ่ม)');
});

test('SEO descriptors (top/rated) prove nothing either', () => {
  const hit = pickVenueHit(ISLAND, BKK, [
    { name: 'Top Cafe Bangkok', distance: 40 },
  ]);
  assert.equal(hit, null);
});

// ── Guards that already existed must keep working (regressions) ──────────────
test('generic hospitality word alone still cannot match (NAM Kitchen case)', () => {
  const hit = pickVenueHit('NAM Kitchen', 'Ho Chi Minh City, Vietnam', [
    { name: 'Three Spice Thai Kitchen', distance: 20 },
  ]);
  assert.equal(hit, null);
});

test('category words alone still cannot match (Specialty Coffee case)', () => {
  const hit = pickVenueHit('Tonkin Specialty Coffee', 'Hanoi, Vietnam', [
    { name: 'Shin Specialty Coffee', distance: 15 },
  ]);
  assert.equal(hit, null);
});

test('a genuinely distinctive token still matches its venue', () => {
  const hit = pickVenueHit('Tonkin Specialty Coffee', 'Hanoi, Vietnam', [
    { name: 'Shin Specialty Coffee', distance: 15 },
    { name: 'Tonkin Coffee Roasters', distance: 30 },
  ]);
  assert.equal(hit?.name, 'Tonkin Coffee Roasters');
});

test('city tokens from `near` still cannot match (Chiangmai case)', () => {
  const hit = pickVenueHit('Garden to Table Chiangmai', 'Chiang Mai, Thailand', [
    { name: 'Chiang Mai Walking Street', distance: 90 },
  ]);
  assert.equal(hit, null);
});

test('hangul names still match space-insensitively (containment branch)', () => {
  // Google name carries the hangul in parentheses; FSQ registered the joined
  // hangul only. Containment + a shared distinctive token must accept it.
  const hit = pickVenueHit('Jumunjin Lighthouse (주문진등대)', 'Gangneung, South Korea', [
    { name: '주문진등대', distance: 25 },
  ]);
  assert.equal(hit?.name, '주문진등대');
});

test('live repro 2026-08-07: FSQ top result with thai+massage cannot steal the hit', () => {
  // Actual top-3 Foursquare returned for The Island's near-search — the old
  // matcher would have taken Wat Pho's massage school on 'thai'.
  const hit = pickVenueHit(ISLAND, BKK, [
    { name: 'Wat Pho Thai Traditional Medical and Massage School', distance: 900 },
    { name: 'May Kaidee Restaurant & Cooking School (หมายขายดี)', distance: 1100 },
    { name: 'Phra Nakorn Bar & Gallery (พระนครบาร์)', distance: 800 },
  ]);
  assert.equal(hit, null);
});

test('most shared distinctive tokens beats FSQ rank (Nami Island case)', () => {
  // Live repro 2026-08-07: with first-match, "Gamja Island" (1 shared token,
  // 'island') beat the real "Nami Island (남이섬)" (2 shared tokens) purely by
  // sorting first in FSQ results.
  const hit = pickVenueHit('Nami Island', 'Chuncheon, South Korea', [
    { name: 'Gamja Island (감자아일랜드)', distance: 40 },
    { name: 'Nami Island (남이섬)', distance: 300 },
  ]);
  assert.equal(hit?.name, 'Nami Island (남이섬)');
});

test('equal scores keep FSQ relevance order', () => {
  const hit = pickVenueHit('Tonkin Specialty Coffee', 'Hanoi, Vietnam', [
    { name: 'Tonkin Coffee Roasters', distance: 30 },
    { name: 'Tonkin Cafe', distance: 60 },
  ]);
  assert.equal(hit?.name, 'Tonkin Coffee Roasters');
});

// ── distinctiveTokens: the stopword list itself ──────────────────────────────
test('cuisine adjectives and business types are no longer distinctive', () => {
  assert.deepEqual(distinctiveTokens('Thai Restaurant Bangkok', BKK), []);
  assert.deepEqual(distinctiveTokens('Thai Massage & Spa Bangkok', BKK), []);
  assert.deepEqual(distinctiveTokens('Vietnamese Restaurant Hanoi', 'Hanoi, Vietnam'), []);
});

test('venues actually NAMED with a stopword keep their real distinctive token', () => {
  // "Ayasofya Turkish Restaurant" must still be matchable via 'ayasofya'.
  assert.deepEqual(
    distinctiveTokens('Ayasofya Turkish Restaurant', 'Kampong Glam, Singapore'),
    ['ayasofya'],
  );
  // The Island keeps 'island' once thai/top/rated are stopped.
  assert.deepEqual(distinctiveTokens(ISLAND, BKK), ['island']);
});

test('"Local Restaurant" stays matchable — local is deliberately NOT a stopword', () => {
  // Two published venues are literally named "Local Restaurant in <city>";
  // adding 'local' to the stopword list would refuse them (over-block, found
  // by corpus sweep 2026-08-07).
  assert.deepEqual(
    distinctiveTokens('Local Restaurant in Gangneung', 'Gangneung, South Korea'),
    ['local'],
  );
});

test('documented trade-off: a landmark named ONLY by a cuisine adjective refuses', () => {
  // "French Market" (New Orleans) loses its last token to the 'french'
  // stopword: FSQ/Flickr matching refuses (returns no photo) rather than risk
  // matching any nearby "French X". Commons covers landmarks like this.
  assert.deepEqual(
    distinctiveTokens('French Market', 'New Orleans, United States'),
    [],
  );
});
