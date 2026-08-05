// Tests for scripts/validate-itineraries.mjs — spawns the script as a real
// subprocess (execFileSync) against fixture directories and asserts exit codes,
// same pattern as this repo's other CLI-gate tests.
//
//   node --test scripts/validate-itineraries.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateI18nEntry, validateItineraryData } from './validate-itineraries.mjs';

const SCRIPT = fileURLToPath(new URL('./validate-itineraries.mjs', import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./lib/itinerary-fixtures/${name}`, import.meta.url));
const GOOD_FIXTURE = fixture('good');
const BAD_FIXTURE = fixture('bad');

function runFixture(dir) {
  try {
    const out = execFileSync('node', [SCRIPT, `--fixture=${dir}`], { encoding: 'utf8', stdio: 'pipe' });
    return { status: 0, out };
  } catch (err) {
    return { status: err.status, out: err.stdout };
  }
}

test('GOOD fixture exits 0 (clean itinerary + matching translation)', () => {
  const { status, out } = runFixture(GOOD_FIXTURE);
  assert.equal(status, 0, out);
  assert.match(out, /clean/);
});

test('GOOD fixture does not flag a venue name containing a digit as a prose leak', () => {
  // "Cafe 3 Stripes" appears in the lunch stop's `why` field in the fixture —
  // it must not trip the price/clock-time prose-leak scan.
  const { out } = runFixture(GOOD_FIXTURE);
  assert.doesNotMatch(out, /PROSE-LEAK/);
});

test('GOOD fixture does not false-positive on checks 3/4 (area claim attested by a stop\'s address)', () => {
  // The fixture's day intro names "Jongno-gu" and the palace stop's
  // place.address literally contains "Jongno-gu" — this is the "legitimate
  // prose that names an area a stop IS actually in" case round 2 explicitly
  // asked to guard against false-positiving on.
  const { status, out } = runFixture(GOOD_FIXTURE);
  assert.equal(status, 0, out);
  assert.doesNotMatch(out, /AREA-CLAIM-UNSUPPORTED/);
  assert.doesNotMatch(out, /UNIVERSAL-AREA-CLAIM/);
});

test('BAD fixture (duplicate slug + over-budget day) exits 1', () => {
  const { status, out } = runFixture(BAD_FIXTURE);
  assert.equal(status, 1);
  assert.match(out, /DUPLICATE-SLUG/);
  assert.match(out, /DAY-BUDGET-EXCEEDED/);
});

test('real content dirs run to completion and produce a well-formed report', () => {
  // NOT asserting exit 0 here: round 2 added checks the real launch-city
  // files (tokyo/seoul/bangkok) are still catching up to as they get
  // regenerated (see task-4 report, "Round 2", for the exact issue list this
  // run produced at the time these checks were added) — a failing exit code
  // is an expected, valid outcome right now, not a test bug. What this test
  // actually guarantees is that the script runs to completion against real
  // content and prints a well-formed report either way, rather than crashing.
  let out;
  try {
    out = execFileSync('node', [SCRIPT], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    out = err.stdout;
  }
  assert.match(out, /^(✓|❌)/);
});

// ── round 2 (2026-07-28): one BAD fixture per new check ─────────────────────
// Each fixture below isolates its one target defect — a minimal 1-day, 3-stop
// itinerary that's otherwise clean, so the assertion is unambiguous.

test('bad-stop-count fixture: STOP-COUNT-CLAIM fires when FAQ claims a stop count the day doesn\'t have', () => {
  const { status, out } = runFixture(fixture('bad-stop-count'));
  assert.equal(status, 1);
  assert.match(out, /STOP-COUNT-CLAIM/);
  assert.match(out, /claims "four stops" but per-day stop counts are \[3\]/);
});

test('bad-duration fixture: DURATION-CONTRADICTION fires when why-text duration disagrees with dwellMin by >50%', () => {
  const { status, out } = runFixture(fixture('bad-duration'));
  assert.equal(status, 1);
  assert.match(out, /DURATION-CONTRADICTION/);
  assert.match(out, /"hour-long" \(~60 min\) but dwellMin is 150/);
});

test('bad-area-claim fixture: AREA-CLAIM-UNSUPPORTED fires when no stop attests a named area', () => {
  const { status, out } = runFixture(fixture('bad-area-claim'));
  assert.equal(status, 1);
  assert.match(out, /AREA-CLAIM-UNSUPPORTED/);
  assert.match(out, /"Fictional Quarter"/);
});

test('bad-universal-area fixture: UNIVERSAL-AREA-CLAIM fires when one stop of an "entirely in X" day isn\'t attested there', () => {
  const { status, out } = runFixture(fixture('bad-universal-area'));
  assert.equal(status, 1);
  assert.match(out, /UNIVERSAL-AREA-CLAIM/);
  assert.match(out, /Harborview/);
  assert.match(out, /"w-c"/);
  // The area IS attested by the OTHER two stops, so the weaker "at least one
  // stop attests it" check (3) must stay silent — only the universal check
  // (4), which requires EVERY stop to attest it, should fire.
  assert.doesNotMatch(out, /AREA-CLAIM-UNSUPPORTED/);
});

test('bad-slot-conflict fixture: SLOT-TIME-CONFLICT fires when an evening-only venue is slotted lunch', () => {
  const { status, out } = runFixture(fixture('bad-slot-conflict'));
  assert.equal(status, 1);
  assert.match(out, /SLOT-TIME-CONFLICT/);
  assert.match(out, /"v-b" reads as evening-only but is slotted "lunch"/);
});

test('bad-transit-minutes fixture: TRANSIT-MINUTES-PRESENT fires when a transit leg still carries a minutes value', () => {
  const { status, out } = runFixture(fixture('bad-transit-minutes'));
  assert.equal(status, 1);
  assert.match(out, /TRANSIT-MINUTES-PRESENT/);
  assert.match(out, /"u-b" walkToNext is transit but minutes=45/);
  // A non-null minutes on a transit leg is ALSO, legitimately, a LEG-STALE
  // mismatch (the solver always computes null there) — both checks firing on
  // the same underlying defect is expected overlap, not a bug.
  assert.match(out, /LEG-STALE/);
});

// ── round 3 (2026-07-28): staleness + implausible-day + rain-swap checks ────
// Real defect that motivated these: a src/lib/itinerary.mjs dwellMinutes()
// fix corrected Gyeongbokgung from a wrongly-parsed 30 min to a real 150 min,
// but seoul-3-days.md had already been generated with the old numbers — every
// stop's cached dwellMin was still the pre-fix under-count, day 3 totalled 90
// minutes for a full day, and validate-itineraries.mjs (pre-round-3) reported
// "clean" because nothing compared the file's numbers against what the solver
// computes from the source posts TODAY.

test('bad-dwell-stale fixture: DWELL-STALE fires when a stop\'s cached dwellMin disagrees with dwellMinutes(post) today', () => {
  const { status, out } = runFixture(fixture('bad-dwell-stale'));
  assert.equal(status, 1);
  assert.match(out, /DWELL-STALE/);
  assert.match(out, /"d-a" dwellMin is 30 but the source post computes 120 today/);
});

test('bad-leg-stale fixture: LEG-STALE fires when a cached walkToNext.km disagrees with walkLeg\(a,b\) today', () => {
  const { status, out } = runFixture(fixture('bad-leg-stale'));
  assert.equal(status, 1);
  assert.match(out, /LEG-STALE/);
  assert.match(out, /"l-a" walkToNext is km=1\.5\/minutes=20\/transit=false but the source posts compute km=2/);
});

test('bad-day-too-short fixture: DAY-TOTAL-TOO-SHORT fires when a day totals under the 4-hour floor', () => {
  const { status, out } = runFixture(fixture('bad-day-too-short'));
  assert.equal(status, 1);
  assert.match(out, /DAY-TOTAL-TOO-SHORT/);
  assert.match(out, /day 1 totals 230 min \(floor 240\)/);
});

test('bad-rain-swap fixture: RAIN-SWAP-IS-STOP fires when rainSwapSlug equals one of the day\'s own stop slugs', () => {
  const { status, out } = runFixture(fixture('bad-rain-swap'));
  assert.equal(status, 1);
  assert.match(out, /RAIN-SWAP-IS-STOP/);
  assert.match(out, /"e-a" is also a stop slug/);
});

test('RAIN-SWAP-DUPLICATE fires when the same rainSwapSlug is reused across two days', () => {
  // Unit-level (not a fixture dir) since it only needs validateItineraryData
  // directly — the postsById/postsList aren't relevant to this rule.
  const data = {
    city: 'Testcity', country: 'Testland', days: 2,
    title: 't', description: 'd', quickAnswer: 'q', faq: [],
    itinerary: [
      {
        label: 'Day 1', intro: 'Intro 1.',
        stops: [
          { slug: 'a', slot: 'morning', why: 'w', dwellMin: 120, walkToNext: null },
          { slug: 'b', slot: 'lunch', why: 'w', dwellMin: 60, walkToNext: null },
          { slug: 'c', slot: 'evening', why: 'w', dwellMin: 120, walkToNext: null },
        ],
        rainSwapSlug: 'z', // not a stop slug anywhere in the file
      },
      {
        label: 'Day 2', intro: 'Intro 2.',
        stops: [
          { slug: 'd', slot: 'morning', why: 'w', dwellMin: 120, walkToNext: null },
          { slug: 'e', slot: 'lunch', why: 'w', dwellMin: 60, walkToNext: null },
          { slug: 'f', slot: 'evening', why: 'w', dwellMin: 120, walkToNext: null },
        ],
        rainSwapSlug: 'z', // reuses day 1's rain swap
      },
    ],
    aiGenerated: true, draft: false,
  };
  const issues = validateItineraryData('test.md', data, new Map(), []);
  assert.ok(issues.some((i) => i.startsWith('RAIN-SWAP-DUPLICATE:')), `expected RAIN-SWAP-DUPLICATE, got: ${issues.join(' | ')}`);
  assert.ok(!issues.some((i) => i.startsWith('RAIN-SWAP-IS-STOP:')), `did not expect RAIN-SWAP-IS-STOP, got: ${issues.join(' | ')}`);
});

// ── validateI18nEntry: empty-string checks (fix round 1, minor) ────────────

test('validateI18nEntry: flags empty day label/intro and empty why', () => {
  const itById = new Map([['seoul-1-days', { stopsHash: 'h1' }]]);
  const data = {
    slug: 'seoul-1-days',
    sourceHash: 'h1',
    title: 't', description: 'd', quickAnswer: 'q', faq: [],
    days: [{ label: '', intro: '   ' }],
    whys: { 'seoul-x': '  ' },
    rainWhys: {},
  };
  const issues = validateI18nEntry('itineraries-i18n/ko/seoul-1-days.md', data, itById);
  assert.ok(issues.some((i) => i.startsWith('EMPTY-LABEL:')), `expected EMPTY-LABEL, got: ${issues.join(' | ')}`);
  assert.ok(issues.some((i) => i.startsWith('EMPTY-INTRO:')), `expected EMPTY-INTRO, got: ${issues.join(' | ')}`);
  assert.ok(issues.some((i) => i.startsWith('EMPTY-WHY:')), `expected EMPTY-WHY, got: ${issues.join(' | ')}`);
});

test('validateI18nEntry: non-empty label/intro/why produce no empty-string issues', () => {
  const itById = new Map([['seoul-1-days', { stopsHash: 'h1' }]]);
  const data = {
    slug: 'seoul-1-days',
    sourceHash: 'h1',
    title: 't', description: 'd', quickAnswer: 'q', faq: [],
    days: [{ label: 'A day', intro: 'Some intro.' }],
    whys: { 'seoul-x': 'A reason.' },
    rainWhys: {},
  };
  const issues = validateI18nEntry('itineraries-i18n/ko/seoul-1-days.md', data, itById);
  assert.deepEqual(issues.filter((i) => i.startsWith('EMPTY-')), []);
});

// ── 파킹된 일정의 번역 신선도 ────────────────────────────────
// 번역기는 draft 를 건너뛰므로, 파킹된 일정의 번역 해시는 파킹 시점에 멈춘다.
// 그것을 결함으로 보면 독자가 볼 수 없는 페이지 때문에 매일 밤 같은 경고가
// 네 건씩 쌓인다(2026-08-05 실제 발생). 재공개는 build → translate 순서라
// 같은 실행에서 갱신되므로 방치가 아니다.
test('parked (draft) itinerary: stale translation is not a defect', () => {
  const source = { slug: 'seoul-3-days', stopsHash: 'NEW', draft: true };
  const issues = validateI18nEntry('ko/seoul-3-days.md',
    { slug: 'seoul-3-days', sourceHash: 'OLD' }, new Map([['seoul-3-days', source]]));
  assert.equal(issues.filter((i) => i.startsWith('STALE-TRANSLATION')).length, 0);
});

test('live itinerary: stale translation IS a defect', () => {
  const source = { slug: 'tokyo-3-days', stopsHash: 'NEW', draft: false };
  const issues = validateI18nEntry('ko/tokyo-3-days.md',
    { slug: 'tokyo-3-days', sourceHash: 'OLD' }, new Map([['tokyo-3-days', source]]));
  assert.equal(issues.filter((i) => i.startsWith('STALE-TRANSLATION')).length, 1);
});

test('live itinerary with matching hash stays silent', () => {
  const source = { slug: 'tokyo-3-days', stopsHash: 'SAME', draft: false };
  const issues = validateI18nEntry('ko/tokyo-3-days.md',
    { slug: 'tokyo-3-days', sourceHash: 'SAME' }, new Map([['tokyo-3-days', source]]));
  assert.equal(issues.filter((i) => i.startsWith('STALE-TRANSLATION')).length, 0);
});
