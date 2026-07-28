import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  findProseViolations,
  findRainSwapLeaks,
  rainVenueTerms,
  validateAiOutput,
  stopsHashOf,
  symmetricDiffSize,
  stopSlugSet,
} from './build-itineraries.mjs';

// ── findProseViolations (hours/price guard, fix 4) ─────────────────────────

test('findProseViolations: clean prose passes', () => {
  assert.deepEqual(findProseViolations('A quiet morning stop with a great view over the harbor.'), []);
});

test('findProseViolations: flags "opens at 9am"', () => {
  const hits = findProseViolations('The market opens at 9am for early risers.');
  assert.ok(hits.length > 0, 'expected at least one violation');
  assert.ok(hits.some((h) => h.pattern === 'hours-language'));
  assert.ok(hits.some((h) => h.pattern === 'clock-time-ampm'));
});

test('findProseViolations: flags "9:00"', () => {
  const hits = findProseViolations('Arrive by 9:00 for the quiet window.');
  assert.ok(hits.some((h) => h.pattern === 'clock-time-24h'));
});

test('findProseViolations: flags currency "₩3,000"', () => {
  const hits = findProseViolations('Tickets run about ₩3,000 per person.');
  assert.ok(hits.some((h) => h.pattern === 'currency-symbol'));
});

test('findProseViolations: flags a currency code like "5000 won"', () => {
  const hits = findProseViolations('Admission is roughly 5000 won at the door.');
  assert.ok(hits.some((h) => h.pattern === 'currency-code'));
});

test('findProseViolations: does not flag a venue name containing a digit', () => {
  assert.deepEqual(findProseViolations('Grab a coffee at Cafe 3 Stripes before heading out.'), []);
});

test('findProseViolations: "closed on" hours-language is flagged even without a clock time', () => {
  const hits = findProseViolations('Note that this spot is closed on Tuesdays.');
  assert.ok(hits.some((h) => h.pattern === 'hours-language'));
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

test('findRainSwapLeaks: flags the venue\'s main token leaking into a day intro', () => {
  const bySlug = new Map([['rain-venue', { data: { title: 'Hidden Museum' } }]]);
  const daysArr = [{ rainSwapSlug: 'rain-venue', stops: [] }];
  const aiOut = {
    title: 't', description: 'd', quickAnswer: 'q', faq: [],
    days: [{ label: 'L', intro: 'A day best spent outdoors near the museum quarter.' }],
    whys: {},
  };
  // "museum" (>=4 chars, from "Hidden Museum") is a main token of the rain venue's title
  const leaks = findRainSwapLeaks(aiOut, daysArr, bySlug);
  assert.ok(leaks.some((l) => l.field === 'days[0].intro'));
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

test('findRainSwapLeaks: days with no rainSwapSlug are never scanned', () => {
  const bySlug = new Map();
  const daysArr = [{ rainSwapSlug: null, stops: [] }];
  const aiOut = { title: 't', description: 'd', quickAnswer: 'q', faq: [], days: [{ label: 'L', intro: 'I' }], whys: {} };
  assert.deepEqual(findRainSwapLeaks(aiOut, daysArr, bySlug), []);
});

test('rainVenueTerms: extracts the full title lowercased plus significant words', () => {
  const terms = rainVenueTerms('Hidden Museum');
  assert.ok(terms.includes('hidden museum'));
  assert.ok(terms.includes('hidden'));
  assert.ok(terms.includes('museum'));
});

test('rainVenueTerms: empty/missing title yields no terms', () => {
  assert.deepEqual(rainVenueTerms(''), []);
  assert.deepEqual(rainVenueTerms(undefined), []);
});

// ── validateAiOutput (response-shape validation) ────────────────────────────

test('validateAiOutput: throws when day count mismatches the solver output', () => {
  const daysArr = [{ stops: [{ slug: 'a' }] }, { stops: [{ slug: 'b' }] }];
  const out = { title: 't', description: 'd', quickAnswer: 'q', faq: [], days: [{ label: 'L', intro: 'I' }], whys: {} };
  assert.throws(() => validateAiOutput(out, daysArr), /day\(s\), expected 2/);
});

test('validateAiOutput: throws when whys references a slug that is not a stop', () => {
  const daysArr = [{ stops: [{ slug: 'a' }] }];
  const out = {
    title: 't', description: 'd', quickAnswer: 'q', faq: [],
    days: [{ label: 'L', intro: 'I' }],
    whys: { 'not-a-real-slug': 'x' },
  };
  assert.throws(() => validateAiOutput(out, daysArr), /unknown stop slug/);
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
