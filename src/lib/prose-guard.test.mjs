import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findProseViolations, PROSE_GUARD_PATTERNS } from './prose-guard.mjs';

test('PROSE_GUARD_PATTERNS has exactly the 5 expected named patterns', () => {
  assert.deepEqual(PROSE_GUARD_PATTERNS.map((p) => p.name), [
    'clock-time-ampm', 'clock-time-24h', 'hours-language', 'currency-symbol', 'currency-code',
  ]);
});

test('clean prose passes', () => {
  assert.deepEqual(findProseViolations('A quiet morning stop with a great view over the harbor.'), []);
});

// ── MUST NOT flag: ordinary prose using open/close with no schedule meaning ─
// (fix round 2: the original hours-language pattern false-positived on every
// one of these in real generated prose and blocked every launch city)
for (const text of [
  'a quiet stream walk close to the palace',
  'close by the market',
  'an open-air food hall',
  'the alley opens onto a plaza',
  'Cafe 3 Stripes',
  'a closed-off pedestrian street',
  'open space',
  // Round 3 (2026-09-09): an itinerary sentence that SCHEDULES THE DAY, not a
  // venue. The Singapore 5-day intro was rejected twice for "The day opens at
  // Sultan Mosque" — a place after "opens at", not a time. Only a time-shaped
  // object (a number, noon, dawn, nine…) makes open/close an hours claim.
  'The day opens at Sultan Mosque, then drifts toward Haji Lane.',
  'The afternoon closes at Clarke Quay with a river breeze.',
  'Day two opens from Chinatown.',
  'The route opens around Kampong Glam.',
  'The market closes on a high note.',
  // From the same sweep of every published post: old-pattern false positives.
  'the Blue Mosque and Hagia Sophia are close at hand',
  'the Alps sitting improbably close on the horizon',
  'not all 300 labels are open at once',
  'the crowd surges the moment doors open at the end',
  'the tour was set to open at Etihad Arena on Yas Island',
]) {
  test(`does not flag: "${text}"`, () => {
    assert.deepEqual(findProseViolations(text), []);
  });
}

// ── MUST flag: real hours/opening claims, clock times, and prices ──────────
const mustFlag = [
  ['opens at 9am', ['hours-language', 'clock-time-ampm']],
  ['closes at 18:00', ['hours-language', 'clock-time-24h']],
  ['closed on Tuesdays', ['hours-language']],
  ['The mosque opens at nine and fills fast', ['hours-language']],
  ['opens at dawn', ['hours-language']],
  ['closes around noon', ['hours-language']],
  ['closes on Mondays', ['hours-language']],
  ['closes on public holidays', ['hours-language']],
  ['opens from 9', ['hours-language']],
  // Real claims the old pattern caught only by accident; keep catching them.
  ['Is the park open at night?', ['hours-language']],
  ['free and open around the clock', ['hours-language']],
  ['open at all hours', ['hours-language']],
  ['generally open from spring through autumn', ['hours-language']],
  ['stalls close on rotating days', ['hours-language']],
  ['closes at the usual time', ['hours-language']],
  ['opening hours vary', ['hours-language']],
  ['open until late', ['hours-language']],
  ['last entry 30 minutes before', ['hours-language']],
  ['₩3,000 entry', ['currency-symbol']],
  ['costs 200 THB', ['currency-code']],
  ['9:00', ['clock-time-24h']],
  ['7 pm', ['clock-time-ampm']],
];
for (const [text, expectedPatterns] of mustFlag) {
  test(`flags: "${text}"`, () => {
    const hits = findProseViolations(text).map((h) => h.pattern);
    for (const p of expectedPatterns) {
      assert.ok(hits.includes(p), `expected pattern "${p}" for "${text}", got [${hits.join(', ')}]`);
    }
  });
}

// ── carried over from the pre-extraction test suite (build-itineraries.test.mjs) ─

test('does not flag a venue name containing a digit (regression case)', () => {
  assert.deepEqual(findProseViolations('Grab a coffee at Cafe 3 Stripes before heading out.'), []);
});

test('flags a currency code like "5000 won"', () => {
  const hits = findProseViolations('Admission is roughly 5000 won at the door.').map((h) => h.pattern);
  assert.ok(hits.includes('currency-code'));
});

test('"opening" (gerund, no "hours") does not false-positive', () => {
  // "quietest right after opening" — real prose from the itinerary fixtures.
  assert.deepEqual(findProseViolations('The grand palace is quietest right after opening, making it the natural first stop.'), []);
});
