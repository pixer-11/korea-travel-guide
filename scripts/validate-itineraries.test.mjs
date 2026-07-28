// Tests for scripts/validate-itineraries.mjs — spawns the script as a real
// subprocess (execFileSync) against fixture directories and asserts exit codes,
// same pattern as this repo's other CLI-gate tests.
//
//   node --test scripts/validate-itineraries.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateI18nEntry } from './validate-itineraries.mjs';

const SCRIPT = fileURLToPath(new URL('./validate-itineraries.mjs', import.meta.url));
const GOOD_FIXTURE = fileURLToPath(new URL('./lib/itinerary-fixtures/good', import.meta.url));
const BAD_FIXTURE = fileURLToPath(new URL('./lib/itinerary-fixtures/bad', import.meta.url));

test('GOOD fixture exits 0 (clean itinerary + matching translation)', () => {
  const out = execFileSync('node', [SCRIPT, `--fixture=${GOOD_FIXTURE}`], { encoding: 'utf8' });
  assert.match(out, /clean/);
});

test('GOOD fixture does not flag a venue name containing a digit as a prose leak', () => {
  // "Cafe 3 Stripes" appears in the lunch stop's `why` field in the fixture —
  // it must not trip the price/clock-time prose-leak scan.
  const out = execFileSync('node', [SCRIPT, `--fixture=${GOOD_FIXTURE}`], { encoding: 'utf8' });
  assert.doesNotMatch(out, /PROSE-LEAK/);
});

test('BAD fixture (duplicate slug + over-budget day) exits 1', () => {
  assert.throws(
    () => execFileSync('node', [SCRIPT, `--fixture=${BAD_FIXTURE}`], { encoding: 'utf8', stdio: 'pipe' }),
    (err) => {
      assert.equal(err.status, 1);
      assert.match(err.stdout, /DUPLICATE-SLUG/);
      assert.match(err.stdout, /DAY-BUDGET-EXCEEDED/);
      return true;
    }
  );
});

test('real content dirs validate cleanly (exit 0) — currently zero itinerary files, so this is the "nothing to validate" path', () => {
  // Not hard-coded to "zero files": once real itinerary content lands, this
  // assertion still holds (exit 0, clean) as long as it's actually valid —
  // that's the whole point of the gate. Only the message differs.
  const out = execFileSync('node', [SCRIPT], { encoding: 'utf8' });
  assert.match(out, /^✓/);
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
