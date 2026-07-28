// Pure-logic + frontmatter round-trip tests for geocode-placeless.mjs.
// Run with: node --test scripts/geocode-placeless.test.mjs
// No network access — the Places API cannot be reached from this machine
// (known 403 on this IP), so these tests cover everything that doesn't
// require a live API call: title→query stripping, the confidence gate,
// and writing the `place:` block back into a real post file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';

import {
  titleMainPart,
  buildQuery,
  nameGatePass,
  evaluateGate,
  businessStatusOk,
  computeCentroid,
  buildCentroids,
  isTarget,
  buildPlaceBlock,
  insertPlaceIntoFrontmatter,
  writePostFile,
} from './geocode-placeless.mjs';

// ── title → query stripping ────────────────────────────────────────────

test('titleMainPart strips a trailing "in {region}"', () => {
  assert.equal(titleMainPart('Ikseon-Dong in Seoul', 'Seoul'), 'Ikseon-Dong');
  assert.equal(titleMainPart('London Bagel Museum in Seoul', 'Seoul'), 'London Bagel Museum');
  assert.equal(titleMainPart('Saladaeng in Bangkok', 'Bangkok'), 'Saladaeng');
  assert.equal(titleMainPart('Oxomoco in Tokyo', 'Tokyo'), 'Oxomoco');
});

test('titleMainPart leaves a title alone when there is no trailing "in {region}"', () => {
  assert.equal(titleMainPart('CAFE 3 STRIPES SEOUL', 'Seoul'), 'CAFE 3 STRIPES SEOUL');
  assert.equal(titleMainPart('StreetXO Ibiza', 'Ibiza'), 'StreetXO Ibiza');
});

// generate.mjs writes venue posts as "{Venue}: {Region} Travel Guide". Left in,
// that whole suffix rode into the Places query ("Gwangjang Market: Seoul Travel
// Guide Seoul") and then into the name gate, which would compare it against the
// result's plain "Gwangjang Market" and reject the correct venue.
test('titleMainPart strips a trailing ": {region} Travel Guide" suffix', () => {
  assert.equal(titleMainPart('Gwangjang Market: Seoul Travel Guide', 'Seoul'), 'Gwangjang Market');
  assert.equal(titleMainPart('Gyeongbokgung Palace: Seoul Travel Guide', 'Seoul'), 'Gyeongbokgung Palace');
  // only the post's OWN region is stripped — a different city stays put
  assert.equal(titleMainPart('Somewhere: Tokyo Travel Guide', 'Seoul'), 'Somewhere: Tokyo Travel Guide');
  // a colon that is part of the venue name is left alone
  assert.equal(titleMainPart('Cafe: The Sequel', 'Seoul'), 'Cafe: The Sequel');
});

test('titleMainPart strips wrapping quote characters', () => {
  assert.equal(titleMainPart(`'Saladaeng in Bangkok'`, 'Bangkok'), 'Saladaeng');
  assert.equal(titleMainPart(`"Ikseon-Dong in Seoul"`, 'Seoul'), 'Ikseon-Dong');
});

test('buildQuery appends the region to the stripped title', () => {
  assert.equal(buildQuery('Ikseon-Dong in Seoul', 'Seoul'), 'Ikseon-Dong Seoul');
});

// ── gate (b): name token overlap ───────────────────────────────────────

test('nameGatePass accepts "Ikseon-Dong in Seoul" vs result displayName "Ikseon-dong" (hyphen/space-insensitive)', () => {
  const tmp = titleMainPart('Ikseon-Dong in Seoul', 'Seoul');
  assert.equal(nameGatePass(tmp, 'Seoul', 'Ikseon-dong'), true);
});

test('nameGatePass rejects an unrelated venue name', () => {
  const tmp = titleMainPart('Ikseon-Dong in Seoul', 'Seoul');
  assert.equal(nameGatePass(tmp, 'Seoul', 'Bukchon Hanok Village'), false);
});

// ── gate (b) fix round 2/3: separator/spacing variants of the SAME place ──
// The token check splits on hyphens/spaces, so "Euljiro" vs "Eulji-ro"
// tokenizes to disjoint sets ({euljiro} vs {eulji, ro}) and used to be
// rejected as a false negative even though they name the same place.
// Round 2 added a fold-and-CONTAINS path for this, but a bare `includes`
// turned out to admit wrong venues too ("The Alley" ⊂ "The Alleyway Café",
// "Villa" ⊂ "Villaggio Italian Restaurant", "Euljiro" ⊂ "Eulji-ro 5-ga" — a
// different, more specific numbered sub-block). Round 3 replaced it with:
// exact-match-after-folding (no length floor — not a coincidence risk) OR
// the shorter (≥8 chars) side matching one of the longer side's leading
// TOKEN-RUN folds (anchored at a token boundary, never mid-word), with a
// trailing numeric/sub-unit leftover token rejected.

test('nameGatePass ACCEPTS "Euljiro" vs result "Eulji-ro" (separator variant, same place)', () => {
  const tmp = titleMainPart('Euljiro in Seoul', 'Seoul');
  assert.equal(nameGatePass(tmp, 'Seoul', 'Eulji-ro'), true);
});

test('nameGatePass ACCEPTS "Saladaeng" vs result "Sala Daeng Road" (spacing variant, same place)', () => {
  const tmp = titleMainPart('Saladaeng in Bangkok', 'Bangkok');
  assert.equal(nameGatePass(tmp, 'Bangkok', 'Sala Daeng Road'), true);
});

test('nameGatePass still REJECTS "Seongsu Cafes" vs unrelated result "Highline"', () => {
  const tmp = titleMainPart('Seongsu Cafes in Seoul', 'Seoul');
  assert.equal(nameGatePass(tmp, 'Seoul', 'Highline'), false);
});

test('nameGatePass still REJECTS "Local Restaurant" vs unrelated result "Rui"', () => {
  const tmp = titleMainPart('Local Restaurant in Gangneung', 'Gangneung');
  assert.equal(nameGatePass(tmp, 'Gangneung', 'Rui'), false);
});

test('nameGatePass still REJECTS "Hidden Gem" vs unrelated result "Jeonju Hanok Village"', () => {
  const tmp = titleMainPart('Hidden Gem in Jeonju', 'Jeonju');
  assert.equal(nameGatePass(tmp, 'Jeonju', 'Jeonju Hanok Village'), false);
});

test('nameGatePass still REJECTS "K-Drama Filming Site" vs unrelated result "Hometown Cha Cha Cha (Filming Location)"', () => {
  const tmp = titleMainPart('K-Drama Filming Site in Pohang', 'Pohang');
  assert.equal(nameGatePass(tmp, 'Pohang', 'Hometown Cha Cha Cha (Filming Location)'), false);
});

test('nameGatePass short-name guard: "Luna" (4 chars, under MIN_SUBSTRING_LEN) does not substring-match "Lunar Park Zagreb"', () => {
  const tmp = titleMainPart('Luna in Rome', 'Rome');
  assert.equal(tmp, 'Luna');
  assert.equal(nameGatePass(tmp, 'Rome', 'Lunar Park Zagreb'), false);
});

test('nameGatePass fold-and-exact-match also folds away diacritics (NFKD)', () => {
  // Chosen so the token path (word split on stopwords/region) genuinely
  // fails first and only the diacritic-folding exact-match path can pass it.
  const tmp = titleMainPart('Émile in Paris', 'Paris');
  assert.equal(nameGatePass(tmp, 'Paris', 'Emile'), true);
});

// ── gate (b) fix round 3: tighten the substring path to token-boundary ──
// anchored matches only, reject numeric sub-unit leftovers, raise the
// short-side floor 5 → 8. These three concrete false-accepts (found by
// re-review against real CI output) must now all FAIL.

test('nameGatePass REJECTS "The Alley" vs "The Alleyway Café" (mid-word match inside a longer word, no token boundary)', () => {
  const tmp = titleMainPart('The Alley in Bangkok', 'Bangkok');
  assert.equal(tmp, 'The Alley');
  assert.equal(nameGatePass(tmp, 'Bangkok', 'The Alleyway Café'), false);
});

test('nameGatePass REJECTS "Villa" vs "Villaggio Italian Restaurant" (below the round-3 8-char floor)', () => {
  const tmp = titleMainPart('Villa in Rome', 'Rome');
  assert.equal(tmp, 'Villa');
  assert.equal(nameGatePass(tmp, 'Rome', 'Villaggio Italian Restaurant'), false);
});

test('nameGatePass REJECTS "Euljiro" vs "Eulji-ro 5-ga" (a specific numbered sub-block, not the street itself)', () => {
  const tmp = titleMainPart('Euljiro in Seoul', 'Seoul');
  assert.equal(nameGatePass(tmp, 'Seoul', 'Eulji-ro 5-ga'), false);
});

test('nameGatePass still ACCEPTS "Euljiro" vs "Eulji-ro" after the round-3 tightening (exact match after folding)', () => {
  const tmp = titleMainPart('Euljiro in Seoul', 'Seoul');
  assert.equal(nameGatePass(tmp, 'Seoul', 'Eulji-ro'), true);
});

test('nameGatePass still ACCEPTS "Saladaeng" vs "Sala Daeng Road" after the round-3 tightening (token-anchored, trailing "road" is not a sub-unit)', () => {
  const tmp = titleMainPart('Saladaeng in Bangkok', 'Bangkok');
  assert.equal(nameGatePass(tmp, 'Bangkok', 'Sala Daeng Road'), true);
});

test('nameGatePass rejects a numeric sub-unit leftover even when the shorter side clears the 8-char floor and lines up on a token boundary', () => {
  // Deliberately a fused single-word title (no internal separator) so the
  // pre-existing token-overlap path (unchanged by round 3) genuinely fails
  // and control reaches the new substring/sub-unit logic being tested here
  // — a multi-word title like "Riverside Market" would instead pass via
  // plain word overlap ("market" aside) before ever reaching this code.
  const tmp = titleMainPart('Saladaeng in Bangkok', 'Bangkok');
  assert.equal(tmp, 'Saladaeng');
  // "2" is a sub-unit qualifier (starts with a digit) → reject.
  assert.equal(nameGatePass(tmp, 'Bangkok', 'Sala Daeng 2'), false);
  // A plain trailing word ("Exit") is NOT a sub-unit → still accepted.
  assert.equal(nameGatePass(tmp, 'Bangkok', 'Sala Daeng Exit'), true);
});

// ── gate (a)+(b) combined: the Oxomoco Brooklyn trap ────────────────────

test('evaluateGate rejects "Oxomoco in Tokyo" matched to the Brooklyn NY restaurant via gate (a), even though the name matches', () => {
  const tmp = titleMainPart('Oxomoco in Tokyo', 'Tokyo');
  const result = {
    id: 'fake-brooklyn-id',
    name: 'Oxomoco',
    address: 'Brooklyn, NY, USA',
    lat: 40.7223,
    lng: -73.9490,
    businessStatus: 'OPERATIONAL',
  };
  // Name gate alone would pass (exact same name) — the point of this test is
  // that the CITY gate must catch it first.
  assert.equal(nameGatePass(tmp, 'Tokyo', result.name), true);

  const centroid = { lat: 35.6762, lng: 139.6503 }; // Tokyo
  const gate = evaluateGate({ titleMainPart: tmp, region: 'Tokyo', result, centroid });
  assert.equal(gate.pass, false);
  assert.match(gate.reason, /city mismatch/i);
});

test('evaluateGate accepts a real Tokyo match within the address AND the radius', () => {
  const tmp = titleMainPart('Oxomoco in Tokyo', 'Tokyo');
  const result = {
    id: 'fake-tokyo-id',
    name: 'Oxomoco',
    address: '1 Chome Shibuya, Tokyo 150-0002, Japan',
    lat: 35.66,
    lng: 139.7,
    businessStatus: 'OPERATIONAL',
  };
  const centroid = { lat: 35.6762, lng: 139.6503 };
  const gate = evaluateGate({ titleMainPart: tmp, region: 'Tokyo', result, centroid });
  assert.equal(gate.pass, true);
});

test('evaluateGate falls back to address-only matching when a region has no centroid', () => {
  const tmp = titleMainPart('Somewhere in Nowhereville', 'Nowhereville');
  const inAddress = {
    id: 'x', name: 'Somewhere', address: '123 Main St, Nowhereville', lat: 1, lng: 1,
  };
  const notInAddress = {
    id: 'y', name: 'Somewhere', address: '123 Main St, Faraway City', lat: 1, lng: 1,
  };
  assert.equal(evaluateGate({ titleMainPart: tmp, region: 'Nowhereville', result: inAddress, centroid: null }).pass, true);
  assert.equal(evaluateGate({ titleMainPart: tmp, region: 'Nowhereville', result: notInAddress, centroid: null }).pass, false);
});

test('evaluateGate rejects a CLOSED business even when city and name match', () => {
  const tmp = titleMainPart('Saladaeng in Bangkok', 'Bangkok');
  const result = {
    id: 'z', name: 'Saladaeng', address: 'Bangkok, Thailand', lat: 13.72, lng: 100.53,
    businessStatus: 'CLOSED_PERMANENTLY',
  };
  const gate = evaluateGate({ titleMainPart: tmp, region: 'Bangkok', result, centroid: null });
  assert.equal(gate.pass, false);
  assert.match(gate.reason, /closed/i);
});

test('businessStatusOk treats a missing status as passing', () => {
  assert.equal(businessStatusOk(undefined), true);
  assert.equal(businessStatusOk('OPERATIONAL'), true);
  assert.equal(businessStatusOk('CLOSED_TEMPORARILY'), false);
  assert.equal(businessStatusOk('CLOSED_PERMANENTLY'), false);
});

// ── centroid math ───────────────────────────────────────────────────────

test('computeCentroid averages lat/lng and returns null for an empty list', () => {
  assert.equal(computeCentroid([]), null);
  const c = computeCentroid([{ lat: 10, lng: 20 }, { lat: 20, lng: 40 }]);
  assert.equal(c.lat, 15);
  assert.equal(c.lng, 30);
});

test('buildCentroids groups by region and ignores draft posts / posts without coords', () => {
  const posts = [
    { fm: { region: 'Seoul', place: { lat: 37.5, lng: 127.0 } } },
    { fm: { region: 'Seoul', place: { lat: 37.6, lng: 127.1 } } },
    { fm: { region: 'Seoul', draft: true, place: { lat: 99, lng: 99 } } }, // excluded (draft)
    { fm: { region: 'Tokyo' } }, // excluded (no place)
  ];
  const centroids = buildCentroids(posts);
  assert.ok(centroids.has('Seoul'));
  assert.equal(centroids.get('Seoul').lat, 37.55);
  assert.equal(centroids.has('Tokyo'), false);
});

// ── target selection ────────────────────────────────────────────────────

test('isTarget selects only non-draft, non-event posts without a place block', () => {
  assert.equal(isTarget({ category: 'restaurant' }), true);
  assert.equal(isTarget({ category: 'restaurant', place: { id: 'x' } }), false);
  assert.equal(isTarget({ category: 'restaurant', draft: true }), false);
  assert.equal(isTarget({ category: 'event' }), false);
});

// A post can carry a place: block that has NO id — seoul-gwangjang-market.md
// was seeded that way, with a placeholder 'cid=example' maps URL and no way to
// re-query Google. The id is what every downstream job keys off (Details
// backfill, refresh, itinerary joins), so an id-less block is functionally
// placeless and has to be re-verified, not skipped forever.
test('isTarget also selects a post whose place block exists but has no id', () => {
  assert.equal(isTarget({ category: 'attraction', place: { name: 'X', lat: 1, lng: 2 } }), true);
  // still excluded for the usual reasons
  assert.equal(isTarget({ category: 'attraction', place: { name: 'X' }, draft: true }), false);
  assert.equal(isTarget({ category: 'event', place: { name: 'X' } }), false);
});

// ── place block shape ───────────────────────────────────────────────────

test('buildPlaceBlock only includes rating/userRatingsTotal/businessStatus when present', () => {
  const full = buildPlaceBlock({
    id: 'abc', name: 'Test Venue', address: '1 Test St',
    rating: 4.5, userRatingsTotal: 100, googleMapsUrl: 'https://maps.google.com/?cid=1',
    businessStatus: 'OPERATIONAL', lat: 1.23, lng: 4.56,
  });
  assert.deepEqual(Object.keys(full), ['id', 'name', 'address', 'rating', 'userRatingsTotal', 'googleMapsUrl', 'businessStatus', 'lat', 'lng']);

  const minimal = buildPlaceBlock({
    id: 'abc', name: 'Test Venue', address: '1 Test St',
    googleMapsUrl: 'https://maps.google.com/?cid=1', lat: 1.23, lng: 4.56,
  });
  assert.deepEqual(Object.keys(minimal), ['id', 'name', 'address', 'googleMapsUrl', 'lat', 'lng']);
});

// Re-verifying an id-less block must not throw away fields Places never
// returns. seoul-gwangjang-market carries a `busyness` object bought from
// BestTime.app (paid, with its own venueId) — losing it on a geocode pass
// would silently delete data this repo cannot re-derive from Google.
test('buildPlaceBlock overwrites verified fields but carries over ones Places never returns', () => {
  const existing = {
    name: 'Gwangjang Market',
    address: 'stale seeded address',
    rating: 4.3,
    priceLevel: 1,
    googleMapsUrl: 'https://maps.google.com/?cid=example', // placeholder, must be replaced
    lat: 37.5701,
    lng: 126.9997,
    busyness: { updated: '2026-07-23', venueId: 'ven_abc', weekdayBusy: [11, 12] },
  };
  const out = buildPlaceBlock({
    id: 'ChIJreal', name: 'Gwangjang Market', address: '88 Changgyeonggung-ro, Jongno-gu, Seoul',
    rating: 4.4, userRatingsTotal: 51234, googleMapsUrl: 'https://maps.google.com/?cid=123',
    businessStatus: 'OPERATIONAL', lat: 37.5700, lng: 126.9996,
  }, existing);

  // every Places-verified field comes from the API response, not the old block
  assert.equal(out.id, 'ChIJreal');
  assert.equal(out.address, '88 Changgyeonggung-ro, Jongno-gu, Seoul');
  assert.equal(out.rating, 4.4);
  assert.equal(out.googleMapsUrl, 'https://maps.google.com/?cid=123');
  assert.equal(out.lat, 37.57);
  // fields Places does not return survive untouched
  assert.deepEqual(out.busyness, existing.busyness);
  assert.equal(out.priceLevel, 1);
  // id leads the block, as in every other post
  assert.equal(Object.keys(out)[0], 'id');
  // caller's object is not mutated
  assert.equal('id' in existing, false);
});

test('buildPlaceBlock without an existing block behaves exactly as before', () => {
  const out = buildPlaceBlock({
    id: 'abc', name: 'Test Venue', address: '1 Test St',
    googleMapsUrl: 'https://maps.google.com/?cid=1', lat: 1.23, lng: 4.56,
  });
  assert.deepEqual(Object.keys(out), ['id', 'name', 'address', 'googleMapsUrl', 'lat', 'lng']);
});

test('insertPlaceIntoFrontmatter replaces an existing place block in place, without duplicating it', () => {
  const fm = {
    title: 'X', region: 'Seoul', gallery: [],
    place: { name: 'old', googleMapsUrl: 'https://maps.google.com/?cid=example' },
    tags: ['a'],
  };
  const place = { id: '1', name: 'new', address: 'addr', googleMapsUrl: 'g', lat: 1, lng: 2 };
  const out = insertPlaceIntoFrontmatter(fm, place);
  assert.deepEqual(Object.keys(out), ['title', 'region', 'gallery', 'place', 'tags']);
  assert.deepEqual(out.place, place); // the NEW block won, not the stale one
  assert.equal(fm.place.name, 'old'); // original untouched
});

test('insertPlaceIntoFrontmatter inserts place right after gallery, preserving all other keys/order', () => {
  const fm = { title: 'X', region: 'Seoul', heroImage: { url: 'u' }, gallery: [], tags: ['a'], draft: false };
  const place = { id: '1', name: 'X', address: 'addr', googleMapsUrl: 'g', lat: 1, lng: 2 };
  const out = insertPlaceIntoFrontmatter(fm, place);
  assert.deepEqual(Object.keys(out), ['title', 'region', 'heroImage', 'gallery', 'place', 'tags', 'draft']);
  assert.deepEqual(out.place, place);
  // original object untouched
  assert.equal('place' in fm, false);
});

// ── frontmatter round-trip write (synthetic fixture, owned by the test) ──
// Round 4: these tests used to read a REAL post (seoul-ikseon-dong.md) as
// their fixture and assert it started placeless. Once the CI geocode run
// actually attached a place: block to that post, the precondition went
// false and the test broke for everyone from then on — a test must never
// depend on the mutable state of live content. Fixtures below are built
// entirely by the test, written to a fresh temp dir, and cleaned up after.
// Deliberately exercises the same shapes real posts have: a quoted string
// (title), a folded ">-" block scalar (description), a nested object
// (heroImage), an array of objects (gallery), a plain array (tags), and a
// Date-typed field (unquoted ISO pubDate — js-yaml parses this as a JS
// Date, which yaml.dump must round-trip correctly).
function syntheticCrlfFixture() {
  const lines = [
    '---',
    "title: 'Test Neighborhood in Testville'",
    'description: >-',
    '  A folded YAML description',
    '  that spans two lines but is',
    '  read back as one string.',
    'region: Testville',
    'category: hidden-gem',
    'pubDate: 2026-07-20T00:00:00.000Z',
    'heroImage:',
    '  url: https://example.com/hero.jpg',
    "  credit: 'Photo: Test User (CC BY)'",
    '  license: wikimedia',
    '  source: https://example.com/source',
    'gallery:',
    '  - url: https://example.com/gallery1.jpg',
    "    credit: 'Photo: Test Gallery (CC BY)'",
    '    license: wikimedia',
    '    source: https://example.com/gallery-source',
    'tags:',
    '  - testville',
    '  - hidden-gem',
    'quickAnswer: A short synthetic quick answer used only by this test.',
    'aiGenerated: true',
    'draft: false',
    '---',
    '',
    '## Why go',
    '',
    'Synthetic CRLF body text that must survive the round-trip untouched.',
    '',
    'A second CRLF paragraph, with a trailing line.',
    '',
  ];
  return lines.join('\r\n');
}

test('writePostFile writes a place: block and leaves every other field + the body untouched (synthetic fixture)', async () => {
  const original = syntheticCrlfFixture();
  assert.ok(original.includes('\r\n'), 'synthetic fixture must be CRLF for this test to be meaningful');

  const dir = await mkdtemp(join(tmpdir(), 'geocode-placeless-test-'));
  const tmpPath = join(dir, 'synthetic-post.md');
  await writeFile(tmpPath, original, 'utf8');

  try {
    const before = matter(original);
    assert.equal(before.data.place, undefined, 'fixture must start placeless for this test to be meaningful');

    const place = buildPlaceBlock({
      id: 'ChIJ-fake-synthetic',
      name: 'Test Neighborhood',
      address: 'Test Neighborhood, Testville',
      rating: 4.4,
      userRatingsTotal: 2100,
      googleMapsUrl: 'https://maps.google.com/?cid=1234567890',
      businessStatus: 'OPERATIONAL',
      lat: 37.5735,
      lng: 126.991,
    });
    const nextFm = insertPlaceIntoFrontmatter(before.data, place);
    await writePostFile(tmpPath, nextFm, before.content, original);

    const rewritten = await readFile(tmpPath, 'utf8');
    const after = matter(rewritten);

    // place block landed with the right values
    assert.deepEqual(after.data.place, place);

    // every other frontmatter field is untouched — including the folded
    // scalar, the nested object, both array shapes, and the Date field.
    assert.equal(Object.keys(before.data).length, Object.keys(after.data).length - 1); // +1 for the new `place` key
    for (const key of Object.keys(before.data)) {
      assert.deepEqual(after.data[key], before.data[key], `field "${key}" changed`);
    }
    assert.ok(after.data.pubDate instanceof Date, 'pubDate should still be a Date after round-tripping');
    assert.deepEqual(after.data.gallery, before.data.gallery);
    assert.equal(after.data.description, 'A folded YAML description that spans two lines but is read back as one string.');

    // body/prose is byte-for-byte identical — round-trip must never touch it
    assert.equal(after.content, before.content);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── line-ending preservation (backfill-place-details.mjs pattern) ──────

test('writePostFile normalizes the WHOLE output to CRLF when the source file is CRLF (no mixed line endings, synthetic fixture)', async () => {
  const original = syntheticCrlfFixture();
  assert.ok(original.includes('\r\n'), 'synthetic fixture must be CRLF for this test to be meaningful');

  const dir = await mkdtemp(join(tmpdir(), 'geocode-placeless-test-'));
  const tmpPath = join(dir, 'crlf-fixture.md');
  await writeFile(tmpPath, original, 'utf8');

  try {
    const before = matter(original);
    const place = buildPlaceBlock({
      id: 'ChIJ-fake', name: 'Test Neighborhood', address: 'Testville',
      googleMapsUrl: 'https://maps.google.com/?cid=1', lat: 37.57, lng: 126.99,
    });
    const nextFm = insertPlaceIntoFrontmatter(before.data, place);
    await writePostFile(tmpPath, nextFm, before.content, original);

    const rewritten = await readFile(tmpPath, 'utf8');
    assert.ok(rewritten.includes('\r\n'), 'expected CRLF line endings in the output');
    // No bare LF anywhere — every \n must be preceded by \r.
    assert.equal(/(?<!\r)\n/.test(rewritten), false, 'found a bare LF in what should be an all-CRLF file');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writePostFile stays all-LF when the source file is LF-only (no mixed line endings)', async () => {
  const lfRaw =
    '---\n' +
    'title: LF Test Post\n' +
    'region: Testland\n' +
    'category: restaurant\n' +
    'heroImage:\n' +
    '  url: https://example.com/x.jpg\n' +
    'gallery: []\n' +
    'draft: false\n' +
    '---\n' +
    '\n' +
    '## Why go\n' +
    '\n' +
    'Some LF-only prose that must survive untouched.\n';
  assert.equal(lfRaw.includes('\r'), false, 'fixture must be LF-only for this test to be meaningful');

  const dir = await mkdtemp(join(tmpdir(), 'geocode-placeless-test-'));
  const tmpPath = join(dir, 'lf-fixture.md');
  await writeFile(tmpPath, lfRaw, 'utf8');

  try {
    const before = matter(lfRaw);
    const place = buildPlaceBlock({
      id: 'ChIJ-fake-lf', name: 'LF Test Post', address: 'Testland',
      googleMapsUrl: 'https://maps.google.com/?cid=2', lat: 1.23, lng: 4.56,
    });
    const nextFm = insertPlaceIntoFrontmatter(before.data, place);
    await writePostFile(tmpPath, nextFm, before.content, lfRaw);

    const rewritten = await readFile(tmpPath, 'utf8');
    assert.equal(rewritten.includes('\r'), false, 'found a CR in what should be an all-LF file');
    const after = matter(rewritten);
    assert.deepEqual(after.data.place, place);
    assert.equal(after.content, before.content);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
