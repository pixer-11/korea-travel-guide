import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCoverageCsv, refreshPoints, slope, judge } from './coverage.mjs';

const BASE = JSON.parse(readFileSync(new URL('../../data/index-coverage-baseline.json', import.meta.url), 'utf8'));

// The real export's shape: BOM, Korean header, empty coverage columns before the
// first refresh, then a step function.
const CSV = '\uFEFF날짜,색인이 생성되지 않은 페이지,색인 생성됨,노출\n'
  + '2026-07-20,,,0\n'
  + '2026-07-24,2174,2450,2639\n'
  + '2026-07-25,3607,5232,3832\n'
  + '2026-07-26,3607,5232,2791\n'
  + '2026-08-21,7993,5229,115\n';

test('parses the export, skipping rows with no coverage yet', () => {
  const s = parseCoverageCsv(CSV);
  assert.equal(s.length, 4);
  assert.deepEqual(s[0], { date: '2026-07-24', indexed: 2450, notIndexed: 2174 });
  assert.equal(s.at(-1).notIndexed, 7993);
});

test('an English export parses too — the header is matched, not the language', () => {
  const en = 'Date,Not indexed,Indexed,Impressions\n2026-08-21,7993,5229,115\n';
  assert.deepEqual(parseCoverageCsv(en), [{ date: '2026-08-21', indexed: 5229, notIndexed: 7993 }]);
});

test('an unrecognisable file yields nothing rather than garbage numbers', () => {
  assert.deepEqual(parseCoverageCsv('a,b,c\n1,2,3\n'), []);
  assert.deepEqual(parseCoverageCsv(''), []);
});

test('the step function collapses to real refreshes', () => {
  const pts = refreshPoints(parseCoverageCsv(CSV));
  assert.equal(pts.length, 3, 'the repeated 07-26 reading is not a refresh');
});

test('slope is measured per day across refreshes', () => {
  const s = [
    { date: '2026-07-25', indexed: 5232, notIndexed: 3607 },
    { date: '2026-08-21', indexed: 5229, notIndexed: 7993 },
  ];
  assert.ok(Math.abs(slope(s, 'notIndexed') - 162.4) < 0.1);
  assert.ok(Math.abs(slope(s, 'indexed') - -0.111) < 0.01);
  assert.equal(slope([s[0]], 'indexed'), null, 'one point has no slope');
});

test('WIN: the indexed count leaves the plateau', () => {
  const v = judge({ date: '2026-09-10', indexed: 5900, notIndexed: 7500 }, BASE);
  assert.equal(v.level, 'win');
});

test('NO EFFECT: intake fell as designed but Google absorbed nothing', () => {
  const v = judge({ date: '2026-09-10', indexed: 5231, notIndexed: 8343 }, BASE);
  assert.equal(v.level, 'no-effect');
  assert.equal(v.key, 'intakeWasNotTheConstraint');
});

test('PARTIAL: queue drains but nothing is kept', () => {
  const v = judge({ date: '2026-09-10', indexed: 5240, notIndexed: 6500 }, BASE);
  assert.equal(v.level, 'partial');
});

test('INVALID beats everything: a throttle that never applied cannot be read', () => {
  // Indexed is up AND the queue exploded — the old slope continued, so the run
  // must be dismissed rather than celebrated.
  const v = judge({ date: '2026-09-10', indexed: 5400, notIndexed: 10600 }, BASE);
  assert.equal(v.level, 'invalid');
});

test('a flat month reads as no-effect, never as success', () => {
  const v = judge({ date: '2026-09-10', indexed: 5229, notIndexed: 7993 }, BASE);
  assert.equal(v.level, 'no-effect');
});

test('the baseline carries its own thresholds, so the judge cannot move them', () => {
  assert.ok(BASE.verdict.thresholds.win.includes('5300'));
  assert.equal(BASE.verdict.primary, 'indexed');
  assert.equal(BASE.latest.indexed, 5229);
});

test('before the agreed date there is no verdict — an early export must not read as failure', () => {
  const v = judge({ date: '2026-08-27', indexed: 5229, notIndexed: 7993 }, BASE);
  assert.equal(v.level, 'too-early');
});

test('on the agreed date the real thresholds apply again', () => {
  const v = judge({ date: BASE.verdict.judgeOn, indexed: 5229, notIndexed: 7993 }, BASE);
  assert.equal(v.level, 'no-effect');
});

test('slope excludes the launch crawl when given a window', () => {
  const s = [
    { date: '2026-07-24', indexed: 2450, notIndexed: 2174 },
    { date: '2026-07-25', indexed: 5232, notIndexed: 3607 },
    { date: '2026-08-21', indexed: 5229, notIndexed: 7993 },
  ];
  // Whole file: the 07-24->07-25 jump fakes growth on a site that has been flat.
  assert.ok(slope(s, 'indexed') > 90, 'unwindowed slope is inflated by the launch crawl');
  // From 07-25 on, the truth: flat.
  assert.ok(Math.abs(slope(s, 'indexed', '2026-07-25')) < 0.5);
  assert.equal(slope(s, 'indexed', '2026-08-21'), null, 'one refresh in the window is no slope');
});

test('BACKFIRED outranks good news — suppressed crawling is a loss coverage cannot offset', () => {
  const v = judge({ date: BASE.verdict.judgeOn, indexed: 5900, notIndexed: 6000, crawlRequests: 20000 }, BASE);
  assert.equal(v.level, 'backfired', 'indexed rose, but crawling collapsed further');
});

test('a healthy crawl figure does not trigger it', () => {
  const v = judge({ date: BASE.verdict.judgeOn, indexed: 5900, notIndexed: 6000, crawlRequests: 50000 }, BASE);
  assert.equal(v.level, 'win');
});

test('no crawl figure supplied — the axis simply does not fire', () => {
  const v = judge({ date: BASE.verdict.judgeOn, indexed: 5900, notIndexed: 6000 }, BASE);
  assert.equal(v.level, 'win');
});
