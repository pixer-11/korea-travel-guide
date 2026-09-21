import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import {
  dayBlock,
  areaFromAddress,
  dayAreas,
  findRainSwapLeaks,
  rainVenueTerms,
  validateAiOutput,
  isProseFixable,
  contextForIssue,
  fixRainFaqIfStale,
  stopsHashOf,
  symmetricDiffSize,
  stopSlugSet,
  commitOrRejectTemp,
  buildPrompt,
  CORRECTION_PROSE_RULES,
  withShapeRetry,
} from './build-itineraries.mjs';

// findProseViolations tests now live in src/lib/prose-guard.mjs's own test
// file (src/lib/prose-guard.test.mjs) — build-itineraries.mjs imports the
// shared implementation rather than defining its own copy (fix round 2).

// ── dayBlock (prompt payload — fix round 3: per-stop address + day structure) ─
// 2026-07-28 fact-check found the model generalizing one stop's neighbourhood
// to a whole day (Tokyo: Ise Sueyoshi near Roppongi/Omotesando called "in the
// Yoyogi/Harajuku area"; Bangkok: Saladaeng at Silom/Rama IV called "Sukhumvit
// and Ekkamai") and asserting stop counts it was never given ("each day is
// built around four stops" when only day 1 actually had four). Both defects
// trace to the prompt payload not carrying addresses or explicit structure.

const dayFixture = (stops, rainSwapSlug = null) => ({ stops, rainSwapSlug });
const stopFixture = (slug, slot, dwellMin = 90, walkToNext = null) => ({ slug, slot, dwellMin, walkToNext });

test('dayBlock: includes each stop\'s verified address', () => {
  const bySlug = new Map([
    ['a', { data: { title: 'Ise Sueyoshi', category: 'restaurant', place: { address: 'Sandwiched between Roppongi and Omotesando' } } }],
  ]);
  const block = dayBlock(dayFixture([stopFixture('a', 'lunch')]), 0, bySlug);
  assert.match(block, /address: Sandwiched between Roppongi and Omotesando/);
});

test('dayBlock: says so explicitly when a stop has no address on file (never invents one)', () => {
  const bySlug = new Map([['a', { data: { title: 'X', category: 'attraction', place: {} } }]]);
  const block = dayBlock(dayFixture([stopFixture('a', 'morning')]), 0, bySlug);
  assert.match(block, /address: \(no address on file/);
});

test('dayBlock: surfaces place.name only when it differs from the post title', () => {
  const bySlugSame = new Map([['a', { data: { title: 'Gwangjang Market', category: 'attraction', place: { name: 'Gwangjang Market', address: 'x' } } }]]);
  const blockSame = dayBlock(dayFixture([stopFixture('a', 'morning')]), 0, bySlugSame);
  assert.doesNotMatch(blockSame, /venue name:/);

  const bySlugDiff = new Map([['a', { data: { title: 'A Great Noodle Spot', category: 'restaurant', place: { name: 'Myeongdong Kyoja', address: 'x' } } }]]);
  const blockDiff = dayBlock(dayFixture([stopFixture('a', 'lunch')]), 0, bySlugDiff);
  assert.match(blockDiff, /venue name: Myeongdong Kyoja/);
});

test('dayBlock: day header states the exact stop count and slot list', () => {
  const bySlug = new Map([
    ['a', { data: { title: 'A', category: 'attraction', place: {} } }],
    ['b', { data: { title: 'B', category: 'restaurant', place: {} } }],
    ['c', { data: { title: 'C', category: 'attraction', place: {} } }],
  ]);
  const day = dayFixture([stopFixture('a', 'morning'), stopFixture('b', 'lunch'), stopFixture('c', 'evening')]);
  const block = dayBlock(day, 1, bySlug); // idx 1 -> "Day 2"
  assert.match(block, /^Day 2 — 3 stops \(morning, lunch, evening\):/);
});

test('dayBlock: singular "stop" wording for a 1-stop day', () => {
  const bySlug = new Map([['a', { data: { title: 'A', category: 'attraction', place: {} } }]]);
  const block = dayBlock(dayFixture([stopFixture('a', 'morning')]), 0, bySlug);
  assert.match(block, /^Day 1 — 1 stop \(morning\):/);
});

// ── areaFromAddress / dayAreas (round 4: per-day area injection) ───────────

test('areaFromAddress: extracts the segment before the city (Tokyo-style address)', () => {
  assert.equal(areaFromAddress('1-1 Yoyogikamizonochō, Shibuya, Tokyo 151-8557, Japan', 'Tokyo'), 'Shibuya');
});

test('areaFromAddress: extracts the segment before the city (Seoul-style address)', () => {
  assert.equal(areaFromAddress('161 Sajik-ro, Jongno District, Seoul, South Korea', 'Seoul'), 'Jongno District');
});

test('areaFromAddress: falls back to the second segment when the city isn\'t found', () => {
  assert.equal(areaFromAddress('123 Some Road, Pathum Wan, Bangkok 10330, Thailand', 'Nonexistent'), 'Pathum Wan');
});

test('areaFromAddress: returns null (never invents) for missing or too-short addresses', () => {
  assert.equal(areaFromAddress('', 'Tokyo'), null);
  assert.equal(areaFromAddress(undefined, 'Tokyo'), null);
  assert.equal(areaFromAddress('Sandwiched between Roppongi and Omotesando', 'Tokyo'), null); // no commas
});

test('dayAreas: distinct areas in stop order, from verified addresses only', () => {
  const bySlug = new Map([
    ['a', { data: { place: { address: '1 Rd, Pathum Wan, Bangkok, Thailand' } } }],
    ['b', { data: { place: { address: '2 Rd, Watthana, Bangkok, Thailand' } } }],
    ['c', { data: { place: { address: '3 Rd, Pathum Wan, Bangkok, Thailand' } } }], // duplicate area
  ]);
  const day = dayFixture([stopFixture('a', 'morning'), stopFixture('b', 'lunch'), stopFixture('c', 'evening')]);
  assert.deepEqual(dayAreas(day, bySlug, 'Bangkok'), ['Pathum Wan', 'Watthana']);
});

test('dayBlock: includes an "Areas covered" line built from the stops\' addresses', () => {
  const bySlug = new Map([
    ['a', { data: { title: 'A', category: 'attraction', place: { address: '1 Rd, Pathum Wan, Bangkok, Thailand' } } }],
    ['b', { data: { title: 'B', category: 'restaurant', place: { address: '2 Rd, Watthana, Bangkok, Thailand' } } }],
  ]);
  const day = dayFixture([stopFixture('a', 'morning'), stopFixture('b', 'lunch')]);
  const block = dayBlock(day, 0, bySlug, 'Bangkok');
  assert.match(block, /Areas covered: Pathum Wan, Watthana/);
});

test('dayBlock: says so explicitly when no stop has a usable address (never invents an area)', () => {
  const bySlug = new Map([['a', { data: { title: 'A', category: 'attraction', place: {} } }]]);
  const block = dayBlock(dayFixture([stopFixture('a', 'morning')]), 0, bySlug, 'Bangkok');
  assert.match(block, /Areas covered: \(no verified addresses/);
});

// ── isProseFixable / contextForIssue (round 4: validator self-correction) ──

test('isProseFixable: true when every issue is on the prose-fixable allowlist', () => {
  assert.equal(isProseFixable([
    'STOP-COUNT-CLAIM: f — x',
    'UNIVERSAL-AREA-CLAIM: f — x',
    'EMPTY-WHY: f — x',
  ]), true);
});

test('isProseFixable: false when ANY issue is structural, even if others are prose-fixable', () => {
  assert.equal(isProseFixable([
    'STOP-COUNT-CLAIM: f — x',
    'DAY-BUDGET-EXCEEDED: f — x',
  ]), false);
});

test('isProseFixable: false for structural-only and for an empty list', () => {
  assert.equal(isProseFixable(['MISSING-POST: f — x']), false);
  assert.equal(isProseFixable([]), false);
});

test('contextForIssue: resolves a title/description/quickAnswer/faq/day field path', () => {
  const fm = {
    title: 'My Title', description: 'My description.', quickAnswer: 'My answer.',
    faq: [{ q: 'Q?', a: 'The answer text.' }],
    itinerary: [{ label: 'Day label', intro: 'Day intro text.', stops: [] }],
  };
  assert.deepEqual(contextForIssue(fm, 'STOP-COUNT-CLAIM: f — title claims "four stops" but...'), [{ field: 'title', text: 'My Title' }]);
  assert.deepEqual(contextForIssue(fm, 'STOP-COUNT-CLAIM: f — faq[0].a claims "four stops" but...'), [{ field: 'faq[0].a', text: 'The answer text.' }]);
  assert.deepEqual(contextForIssue(fm, 'STOP-COUNT-CLAIM: f — itinerary[0].intro claims "four stops" but...'), [{ field: 'itinerary[0].intro', text: 'Day intro text.' }]);
});

test('contextForIssue: resolves a "day N stop" reference to that stop\'s why', () => {
  const fm = { itinerary: [{ label: 'L', intro: 'I', stops: [{ slug: 'x', why: 'Why for x.' }] }] };
  const ctx = contextForIssue(fm, 'DURATION-CONTRADICTION: f — day 1 stop "x" why says "several hours" (~210 min) but dwellMin is 90');
  assert.deepEqual(ctx, [{ field: 'day 1 stop "x" why', text: 'Why for x.' }]);
});

test('contextForIssue: resolves a day-only reference to that day\'s label+intro', () => {
  const fm = { itinerary: [{ label: 'L', intro: 'I', stops: [] }, { label: 'Day 2 label', intro: 'Day 2 intro.', stops: [] }] };
  const ctx = contextForIssue(fm, 'AREA-CLAIM-UNSUPPORTED: f — day 2 names "Siam Paragon" but no stop of that day attests it');
  assert.deepEqual(ctx, [
    { field: 'itinerary[1].label', text: 'Day 2 label' },
    { field: 'itinerary[1].intro', text: 'Day 2 intro.' },
  ]);
});

test('contextForIssue: returns [] for an unrecognized issue shape (no crash)', () => {
  assert.deepEqual(contextForIssue({}, 'SOMETHING-UNEXPECTED: f — nothing to parse here'), []);
});

// ── fixRainFaqIfStale (round 4: rain-FAQ staleness fix) ─────────────────────

test('fixRainFaqIfStale: rewrites the rain FAQ answer to match the day that KEPT its swap', () => {
  const aiOut = { faq: [{ q: 'What if it rains?', a: 'Day one has a listed rain-day alternative restaurant to swap in.' }] };
  const daysArr = [{ rainSwapSlug: 'kept-venue' }, { rainSwapSlug: null }];
  fixRainFaqIfStale(aiOut, daysArr, new Set([1])); // day 2 (index 1) was dropped
  assert.match(aiOut.faq[0].a, /^Day 1 has a listed rain-day alternative/);
});

test('fixRainFaqIfStale: rewrites to "none" when every rainSwapSlug ended up null', () => {
  const aiOut = { faq: [{ q: 'What happens if it rains?', a: 'Day one has a rain plan.' }] };
  const daysArr = [{ rainSwapSlug: null }, { rainSwapSlug: null }];
  fixRainFaqIfStale(aiOut, daysArr, new Set([0]));
  assert.match(aiOut.faq[0].a, /^None of the days/);
});

test('fixRainFaqIfStale: no-op when nothing was dropped', () => {
  const aiOut = { faq: [{ q: 'What if it rains?', a: 'Original answer.' }] };
  fixRainFaqIfStale(aiOut, [{ rainSwapSlug: 'x' }], new Set());
  assert.equal(aiOut.faq[0].a, 'Original answer.');
});

test('fixRainFaqIfStale: no-op when there\'s no rain-related FAQ entry', () => {
  const aiOut = { faq: [{ q: 'How much walking?', a: 'Some.' }] };
  fixRainFaqIfStale(aiOut, [{ rainSwapSlug: null }], new Set([0]));
  assert.equal(aiOut.faq[0].a, 'Some.');
});

// ── findRainSwapLeaks (rain-swap isolation, fix 3) ──────────────────────────

test('findRainSwapLeaks: flags the rain-swap venue name leaking into a why', () => {
  const bySlug = new Map([['rain-venue', { data: { title: 'Hidden Museum' } }]]);
  const daysArr = [{ rainSwapSlug: 'rain-venue', stops: [] }];
  const aiOut = {
    title: 't', description: 'd', quickAnswer: 'q', faq: [],
    days: [{ label: 'L', intro: 'I' }],
    whys: { x: 'Great spot, or try Hidden Museum if it rains.' },
  };
  const leaks = findRainSwapLeaks(aiOut, daysArr, bySlug);
  assert.equal(leaks.length, 1);
  assert.equal(leaks[0].dayIndex, 0);
  assert.equal(leaks[0].field, 'whys[x]');
});

test('findRainSwapLeaks: flags the venue name leaking into a day intro', () => {
  const bySlug = new Map([['rain-venue', { data: { title: 'Hidden Museum' } }]]);
  const daysArr = [{ rainSwapSlug: 'rain-venue', stops: [] }];
  const aiOut = {
    title: 't', description: 'd', quickAnswer: 'q', faq: [],
    days: [{ label: 'L', intro: 'A day best spent indoors, ending at the Hidden Museum.' }],
    whys: {},
  };
  const leaks = findRainSwapLeaks(aiOut, daysArr, bySlug);
  assert.ok(leaks.some((l) => l.field === 'days[0].intro'));
});

test('findRainSwapLeaks: one ordinary word out of the venue name is not a leak', () => {
  // Was the opposite assertion until 2026-08-12: "museum" alone counted, so an
  // intro about the museum quarter dropped a rain option for a venue it never
  // named. On real data ("American Museum of Natural History", "Ocean Prime",
  // "Strand Bookstore") the words that did it were "natural", "ocean" and
  // "strand" — New York shipped with no rain option on any of its three days.
  const bySlug = new Map([['rain-venue', { data: { title: 'Hidden Museum' } }]]);
  const daysArr = [{ rainSwapSlug: 'rain-venue', stops: [] }];
  const aiOut = {
    title: 't', description: 'd', quickAnswer: 'q', faq: [],
    days: [{ label: 'L', intro: 'A day best spent outdoors near the museum quarter.' }],
    whys: {},
  };
  assert.deepEqual(findRainSwapLeaks(aiOut, daysArr, bySlug), []);
});

test('rainVenueTerms: pairs, not lone ordinary words — and a one-word name still stands alone', () => {
  assert.deepEqual(
    rainVenueTerms('American Museum of Natural History', 'New York'),
    ['american museum of natural history', 'american museum', 'museum natural', 'natural history'],
  );
  assert.deepEqual(rainVenueTerms('Balthazar', 'New York'), ['balthazar']);
});

test('findRainSwapLeaks: no leak when the venue is never mentioned', () => {
  const bySlug = new Map([['rain-venue', { data: { title: 'Hidden Museum' } }]]);
  const daysArr = [{ rainSwapSlug: 'rain-venue', stops: [] }];
  const aiOut = {
    title: 't', description: 'd', quickAnswer: 'q', faq: [],
    days: [{ label: 'L', intro: 'A pleasant stop with a nice view.' }],
    whys: { x: 'A quiet, well-rated spot worth the detour.' },
  };
  assert.deepEqual(findRainSwapLeaks(aiOut, daysArr, bySlug), []);
});

test('findRainSwapLeaks: a city name embedded in the venue title is not treated as a leak signal (real-data regression)', () => {
  // Real Seoul run: rain-swap title was "London Bagel Museum in Seoul" — since
  // "Seoul" is >=4 chars and not a stopword, it became a "main token" that
  // matched almost every field (title/description/every intro all say
  // "Seoul"), dropping the rain-swap on nearly every itinerary. Passing the
  // city name excludes it from the per-word terms.
  const bySlug = new Map([['rain-venue', { data: { title: 'Seoul Bagel Museum' } }]]);
  const daysArr = [{ rainSwapSlug: 'rain-venue', stops: [] }];
  const aiOut = {
    title: 'A 3-Day Seoul Itinerary', description: 'Seoul highlights.', quickAnswer: 'Seoul in 3 days.', faq: [],
    days: [{ label: 'Seoul Day 1', intro: 'Seoul bagel stalls open before the museums do.' }],
    whys: { x: 'A well-rated stop in Seoul worth the detour.' },
  };
  assert.deepEqual(findRainSwapLeaks(aiOut, daysArr, bySlug, 'Seoul'), []);
  // Without the city-name exclusion "seoul bagel" is a term, and an intro about
  // Seoul bagel stalls reads as the venue being named.
  const leaksWithoutCityArg = findRainSwapLeaks(aiOut, daysArr, bySlug);
  assert.ok(leaksWithoutCityArg.length > 0, 'sanity check: the bug is real without the cityName argument');
});

test('findRainSwapLeaks: still catches an actual leak of the venue-specific words even when cityName is given', () => {
  const bySlug = new Map([['rain-venue', { data: { title: 'London Bagel Museum in Seoul' } }]]);
  const daysArr = [{ rainSwapSlug: 'rain-venue', stops: [] }];
  const aiOut = {
    title: 't', description: 'd', quickAnswer: 'q', faq: [],
    days: [{ label: 'L', intro: 'If it rains, the bagel museum nearby is a cozy backup.' }],
    whys: {},
  };
  const leaks = findRainSwapLeaks(aiOut, daysArr, bySlug, 'Seoul');
  assert.ok(leaks.some((l) => l.field === 'days[0].intro'));
});

test('findRainSwapLeaks: days with no rainSwapSlug are never scanned', () => {
  const bySlug = new Map();
  const daysArr = [{ rainSwapSlug: null, stops: [] }];
  const aiOut = { title: 't', description: 'd', quickAnswer: 'q', faq: [], days: [{ label: 'L', intro: 'I' }], whys: {} };
  assert.deepEqual(findRainSwapLeaks(aiOut, daysArr, bySlug), []);
});

test('rainVenueTerms: extracts the full title lowercased plus adjacent word pairs', () => {
  const terms = rainVenueTerms('Hidden Museum');
  assert.ok(terms.includes('hidden museum'));
  assert.ok(!terms.includes('museum'), 'a lone ordinary word is not a term');
});

test('rainVenueTerms: empty/missing title yields no terms', () => {
  assert.deepEqual(rainVenueTerms(''), []);
  assert.deepEqual(rainVenueTerms(undefined), []);
});

test('rainVenueTerms: excludes the given city name from pair terms but keeps the full title', () => {
  const terms = rainVenueTerms('London Bagel Museum in Seoul', 'Seoul');
  assert.ok(!terms.some((t) => t.includes('seoul') && t !== 'london bagel museum in seoul'),
    'city name must not appear in any term but the full title');
  assert.ok(terms.includes('london bagel'));
  assert.ok(terms.includes('bagel museum'));
  assert.ok(terms.includes('london bagel museum in seoul'), 'the full title is still a term (exact-phrase match is a real signal)');
});

test('rainVenueTerms: without a cityName argument, the city name IS paired (documents the bug this guards against)', () => {
  const terms = rainVenueTerms('London Bagel Museum in Seoul');
  assert.ok(terms.includes('museum seoul'));
});

// ── validateAiOutput (response-shape validation) ────────────────────────────

test('validateAiOutput: throws when day count mismatches the solver output', () => {
  const daysArr = [{ stops: [{ slug: 'a' }] }, { stops: [{ slug: 'b' }] }];
  const out = { title: 't', description: 'd', quickAnswer: 'q', faq: [], days: [{ label: 'L', intro: 'I' }], whys: {} };
  assert.throws(() => validateAiOutput(out, daysArr), /day\(s\), expected 2/);
});

// An unknown whys key no longer fails the city (2026-08-13): Singapore's
// first-ever build died because the model keyed one why as
// "jurong-lake-gardens" instead of "jurong-jurong-lake-gardens" — a dictionary
// spelling problem, not a wrong fact. Three directions pinned:
test('validateAiOutput: a why keyed by a unique slug SUFFIX is remapped, not fatal', () => {
  const daysArr = [{ stops: [{ slug: 'jurong-jurong-lake-gardens' }] }];
  const out = {
    title: 't', description: 'd', quickAnswer: 'q', faq: [],
    days: [{ label: 'L', intro: 'I' }],
    whys: { 'jurong-lake-gardens': 'the why text' },
  };
  assert.doesNotThrow(() => validateAiOutput(out, daysArr));
  assert.equal(out.whys['jurong-jurong-lake-gardens'], 'the why text');
  assert.ok(!('jurong-lake-gardens' in out.whys));
});

test('validateAiOutput: an unrecognizable whys key is dropped and the rest survive', () => {
  const daysArr = [{ stops: [{ slug: 'a' }] }];
  const out = {
    title: 't', description: 'd', quickAnswer: 'q', faq: [],
    days: [{ label: 'L', intro: 'I' }],
    whys: { 'not-a-real-slug': 'x', a: 'kept' },
  };
  assert.doesNotThrow(() => validateAiOutput(out, daysArr));
  assert.ok(!('not-a-real-slug' in out.whys));
  assert.equal(out.whys.a, 'kept');
});

test('validateAiOutput: a suffix matching TWO stops is ambiguous — dropped, never guessed', () => {
  const daysArr = [{ stops: [{ slug: 'x-night-market' }, { slug: 'y-night-market' }] }];
  const out = {
    title: 't', description: 'd', quickAnswer: 'q', faq: [],
    days: [{ label: 'L', intro: 'I' }],
    whys: { 'night-market': 'whose?' },
  };
  assert.doesNotThrow(() => validateAiOutput(out, daysArr));
  assert.ok(!('night-market' in out.whys));
  assert.ok(!('x-night-market' in out.whys));
  assert.ok(!('y-night-market' in out.whys));
});

test('validateAiOutput: throws when a day is missing label/intro', () => {
  const daysArr = [{ stops: [{ slug: 'a' }] }];
  const out = { title: 't', description: 'd', quickAnswer: 'q', faq: [], days: [{ label: 'L' }], whys: {} };
  assert.throws(() => validateAiOutput(out, daysArr));
});

test('validateAiOutput: passes for well-formed output', () => {
  const daysArr = [{ stops: [{ slug: 'a' }, { slug: 'b' }] }];
  const out = {
    title: 't', description: 'd', quickAnswer: 'q', faq: [{ q: 'Q?', a: 'A.' }],
    days: [{ label: 'L', intro: 'I' }],
    whys: { a: 'why a', b: 'why b' },
  };
  assert.doesNotThrow(() => validateAiOutput(out, daysArr));
});

// ── stopsHashOf / symmetricDiffSize / stopSlugSet (structural helpers) ─────

test('stopsHashOf: matches the spec formula (sha1 of joined slugs, days joined by |)', () => {
  const daysArr = [{ stops: [{ slug: 'a' }, { slug: 'b' }] }, { stops: [{ slug: 'c' }] }];
  const expected = createHash('sha1').update('a,b|c').digest('hex');
  assert.equal(stopsHashOf(daysArr), expected);
});

test('symmetricDiffSize: counts slugs present in only one set', () => {
  assert.equal(symmetricDiffSize(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd'])), 2);
  assert.equal(symmetricDiffSize(new Set(['a']), new Set(['a'])), 0);
  assert.equal(symmetricDiffSize(new Set(), new Set(['a', 'b'])), 2);
});

test('stopSlugSet: flattens all stop slugs across days into one set', () => {
  const daysArr = [{ stops: [{ slug: 'a' }, { slug: 'b' }] }, { stops: [{ slug: 'b' }, { slug: 'c' }] }];
  assert.deepEqual(stopSlugSet(daysArr), new Set(['a', 'b', 'c']));
});

// ── commitOrRejectTemp (accuracy-gate wiring, fix round 1) ──────────────────
// Runs scripts/validate-itineraries.mjs's validateItineraryFile against a temp
// file before deciding whether to rename() it over the target — the guarantee
// under test is that a bad temp file is deleted and the target is never
// created/replaced, without going through the Claude-calling pipeline.

const TEST_POSTS = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
  id,
  data: {
    region: 'TestCity',
    category: id === 'b' || id === 'd' ? 'restaurant' : 'attraction',
    draft: false,
    place: { lat: 1, lng: 1, businessStatus: 'OPERATIONAL' },
  },
}));

function stop(slug, slot, dwellMin, walkToNext = null) {
  return { slug, slot, why: `Why for ${slug}.`, dwellMin, walkToNext };
}

function fmToMd(fm) {
  return `---\n${yaml.dump(fm, { lineWidth: -1, noRefs: true, sortKeys: false })}---\n`;
}

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'itin-wiring-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('commitOrRejectTemp: a temp file with a duplicate slug is rejected — deleted, target never created', async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, 'testcity-2-days.md');
    const tmpPath = `${filePath}.tmp-test`;
    const fm = {
      city: 'TestCity', country: 'Testland', days: 2,
      title: 't', description: 'd', quickAnswer: 'q',
      pubDate: '2026-01-01T00:00:00.000Z', stopsHash: 'h', packedAvailable: false, faq: [],
      itinerary: [
        { label: 'Day 1', intro: 'Intro 1.', stops: [stop('a', 'morning', 60), stop('b', 'lunch', 60), stop('c', 'evening', 60)], rainSwapSlug: null },
        // "a" repeats from day 1 -> DUPLICATE-SLUG
        { label: 'Day 2', intro: 'Intro 2.', stops: [stop('a', 'morning', 60), stop('d', 'lunch', 60), stop('e', 'evening', 60)], rainSwapSlug: null },
      ],
      aiGenerated: true, draft: false,
    };
    await writeFile(tmpPath, fmToMd(fm), 'utf8');

    const result = await commitOrRejectTemp(tmpPath, filePath, { posts: TEST_POSTS, label: 'TestCity 2d' });

    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.includes('DUPLICATE-SLUG')), `expected a DUPLICATE-SLUG issue, got: ${result.issues.join(' | ')}`);
    assert.ok(!existsSync(tmpPath), 'temp file must be deleted on a failed validation');
    assert.ok(!existsSync(filePath), 'target file must never be created from a temp file that failed validation');
  });
});

test('commitOrRejectTemp: a temp file with an over-budget day is rejected and an EXISTING target is left untouched', async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, 'testcity-1-days.md');
    // Simulate a previously-good, already-live file at the target path.
    const goodFm = {
      city: 'TestCity', country: 'Testland', days: 1,
      title: 'old', description: 'old', quickAnswer: 'old',
      pubDate: '2026-01-01T00:00:00.000Z', stopsHash: 'old-hash', packedAvailable: false, faq: [],
      itinerary: [{ label: 'Day 1', intro: 'Old intro.', stops: [stop('a', 'morning', 60), stop('b', 'lunch', 60), stop('c', 'evening', 60)], rainSwapSlug: null }],
      aiGenerated: true, draft: false,
    };
    await writeFile(filePath, fmToMd(goodFm), 'utf8');

    const tmpPath = `${filePath}.tmp-test`;
    const badFm = {
      ...goodFm,
      stopsHash: 'new-hash',
      itinerary: [{
        label: 'Day 1', intro: 'New intro.',
        // 300+300+300 dwell, no legs = 900 min > 600 budget -> DAY-BUDGET-EXCEEDED
        stops: [stop('a', 'morning', 300), stop('d', 'lunch', 300), stop('e', 'evening', 300)],
        rainSwapSlug: null,
      }],
    };
    await writeFile(tmpPath, fmToMd(badFm), 'utf8');

    const result = await commitOrRejectTemp(tmpPath, filePath, { posts: TEST_POSTS, label: 'TestCity 1d' });

    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.includes('DAY-BUDGET-EXCEEDED')), `expected a DAY-BUDGET-EXCEEDED issue, got: ${result.issues.join(' | ')}`);
    assert.ok(!existsSync(tmpPath), 'temp file must be deleted on a failed validation');
    const stillThere = yaml.load(readFileSync(filePath, 'utf8').split('\n---')[0].slice(4));
    assert.equal(stillThere.stopsHash, 'old-hash', 'existing target must be untouched by a failed regeneration');
  });
});

test('commitOrRejectTemp: a clean temp file is renamed over the target', async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, 'testcity-1-days.md');
    const tmpPath = `${filePath}.tmp-test`;
    const fm = {
      city: 'TestCity', country: 'Testland', days: 1,
      title: 't', description: 'd', quickAnswer: 'q',
      pubDate: '2026-01-01T00:00:00.000Z', stopsHash: 'clean-hash', packedAvailable: false, faq: [],
      // dwellMin values here must match what dwellMinutes() actually computes
      // for TEST_POSTS (no body text -> category default: attraction 120,
      // restaurant 60) — validate-itineraries.mjs's round-3 DWELL-STALE check
      // now recomputes and compares, so a "clean" fixture has to be genuinely
      // fresh, not just internally plausible.
      itinerary: [{ label: 'Day 1', intro: 'Intro.', stops: [stop('a', 'morning', 120), stop('b', 'lunch', 60), stop('c', 'evening', 120)], rainSwapSlug: null }],
      aiGenerated: true, draft: false,
    };
    await writeFile(tmpPath, fmToMd(fm), 'utf8');

    const result = await commitOrRejectTemp(tmpPath, filePath, { posts: TEST_POSTS, label: 'TestCity 1d' });

    assert.equal(result.ok, true);
    assert.deepEqual(result.issues, []);
    assert.ok(!existsSync(tmpPath), 'temp file must be gone after a successful rename');
    assert.ok(existsSync(filePath), 'target file must exist after a successful commit');
  });
});

// ── 하루 라벨/인트로는 문장형으로 쓰게 한다 (2026-09-21 서울 5일) ──────────
// 검사기의 AREA-CLAIM-UNSUPPORTED 는 "연속된 대문자 단어 2개 = 지역명 주장"
// 이라는 전제 위에 서 있다(scripts/validate-itineraries.test.mjs 에 그 결합을
// 고정해 뒀다). 프롬프트는 예시로만 문장형을 보여줬을 뿐 규칙으로 말한 적이
// 없어서, 모델이 제목형을 굴릴 때마다 평범한 묘사구가 지어낸 지역명으로 읽혀
// 거절됐다 — 5일은 라벨이 5개라 3일보다 그 확률이 그만큼 높다. 배포된 라벨
// 51개가 전부 문장형인 것은 규칙이 아니라 생존편향이었다.
test('buildPrompt: states the sentence-case rule for day labels and intros', () => {
  const prompt = buildPrompt({
    city: 'Seoul', country: 'South Korea', days: 5,
    daysArr: [dayFixture([stopFixture('a', 'morning')])],
    bySlug: new Map([['a', { data: { title: 'A', place: { address: 'Jongno-gu, Seoul' } } }]]),
  });
  assert.match(prompt, /sentence case/i);
  assert.match(prompt, /proper nouns?/i);
});

test('CORRECTION_PROSE_RULES: restates the sentence-case rule where the correction pass can see it', () => {
  // 시계 시각 규칙이 여기 다시 적힌 것과 같은 이유다 — 교정 호출은 지적된
  // 항목에만 집중하느라 본 프롬프트의 규칙을 흘린다. 실제로 교정 1회가
  // 항목 1개를 고치면서 제목형 라벨 2개를 새로 만들어 냈다(09-21 재현).
  assert.match(CORRECTION_PROSE_RULES, /sentence case/i);
});

// ── 모양이 깨진 모델 응답은 한 번 다시 물어본다 ────────────────────────
// 2026-09-21 서울 5일은 `model output missing faq array` 하나로 그날 도시
// 전체가 중단됐다(ERROR processing Seoul). 토큰 잘림은 아니었다 — 실측
// out=2708/4000 로 여유가 컸다. 그냥 한 번 어긋난 응답이고, 다시 물어보는
// 값이 하루를 통째로 잃는 값보다 싸다. 재시도는 정확히 1회.
test('withShapeRetry: a malformed first reply is asked once more, and the good one wins', async () => {
  let calls = 0;
  const out = await withShapeRetry(async () => {
    calls += 1;
    if (calls === 1) throw new Error('model output missing faq array (stop_reason=tool_use)');
    return { ok: true };
  }, { variantId: 'Seoul 5d' });
  assert.equal(calls, 2);
  assert.deepEqual(out, { ok: true });
});

test('withShapeRetry: a good first reply costs exactly one call', async () => {
  let calls = 0;
  await withShapeRetry(async () => { calls += 1; return { ok: true }; }, { variantId: 'Seoul 5d' });
  assert.equal(calls, 1);
});

test('withShapeRetry: gives up after the one retry (never loops)', async () => {
  let calls = 0;
  await assert.rejects(
    () => withShapeRetry(async () => { calls += 1; throw new Error('model output missing faq array'); }, { variantId: 'Seoul 5d' }),
    /missing faq array/,
  );
  assert.equal(calls, 2);
});
