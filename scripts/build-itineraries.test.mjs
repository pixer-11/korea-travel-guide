import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import {
  findProseViolations,
  findRainSwapLeaks,
  rainVenueTerms,
  validateAiOutput,
  stopsHashOf,
  symmetricDiffSize,
  stopSlugSet,
  commitOrRejectTemp,
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
      itinerary: [{ label: 'Day 1', intro: 'Intro.', stops: [stop('a', 'morning', 60), stop('b', 'lunch', 60), stop('c', 'evening', 60)], rainSwapSlug: null }],
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
