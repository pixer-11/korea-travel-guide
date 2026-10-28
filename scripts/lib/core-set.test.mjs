import test from 'node:test';
import assert from 'node:assert/strict';
import { isIndexed, daysBetween, summarize, judgeCohort, formatReport } from './core-set.mjs';

const U = (s) => `https://wanderatlasguides.com/posts/${s}/`;
const TODAY = '2026-11-20';
const START = '2026-10-28';

// 10-28 기준선 모양 그대로: 노출 있는 글 다섯, 허브 하나. a·b 는 직접 경험 글(firsthand).
const rows = [
  { url: U('hcmc-a'), kind: 'posts', country: 'Vietnam', coverageState: 'Submitted and indexed', lastCrawlTime: '2026-11-10T01:00:00Z', impressions: 12 },
  { url: U('hcmc-b'), kind: 'posts', country: 'Vietnam', coverageState: 'Discovered - currently not indexed', lastCrawlTime: null, impressions: 0 },
  { url: U('hcmc-c'), kind: 'posts', country: 'Vietnam', coverageState: 'Submitted and indexed', lastCrawlTime: '2026-07-01T01:00:00Z', impressions: 3 },
  { url: U('hcmc-d'), kind: 'posts', country: 'Vietnam', coverageState: 'Submitted and indexed', lastCrawlTime: '2026-08-01T01:00:00Z', impressions: 0 },
  { url: U('seattle-e'), kind: 'posts', country: 'United States', coverageState: 'Submitted and indexed', lastCrawlTime: '2026-11-15T01:00:00Z', impressions: 80 },
  { url: 'https://wanderatlasguides.com/essentials/vietnam/', kind: 'essentials', country: 'Vietnam', coverageState: 'Submitted and indexed', lastCrawlTime: '2026-11-01T01:00:00Z', impressions: 5 },
  { url: U('broken'), kind: 'posts', country: 'Japan', error: true },
];
const groups = { firsthand: new Set([U('hcmc-a'), U('hcmc-b')]) };
const baseline = new Map([
  [U('hcmc-a'), { coverageState: 'Submitted and indexed' }],
  [U('hcmc-b'), { coverageState: 'Discovered - currently not indexed' }],
  [U('hcmc-c'), { coverageState: 'Submitted and indexed' }],
]);

test('isIndexed reads the API wording, not a substring', () => {
  assert.equal(isIndexed('Submitted and indexed'), true);
  assert.equal(isIndexed('Indexed, not submitted in sitemap'), true);
  assert.equal(isIndexed('Discovered - currently not indexed'), false);
  assert.equal(isIndexed('Crawled - currently not indexed'), false);
  assert.equal(isIndexed(''), false);
});

test('daysBetween is whole days and refuses garbage', () => {
  assert.equal(daysBetween('2026-10-01T00:00:00Z', '2026-10-28T12:00:00Z'), 27);
  assert.equal(daysBetween('nope', '2026-10-28'), null);
});

test('summarize: rates exclude errors, stale is indexed-and-old, control is same-country posts outside groups', () => {
  const s = summarize(rows, { today: TODAY, cohortStart: START, groups, baseline });
  assert.equal(s.n, 6);
  assert.equal(s.measured, 6);
  assert.equal(s.errors, 1);
  assert.equal(s.indexed, 5);
  assert.equal(s.exposed, 4);
  // hcmc-c(07-01)·hcmc-d(08-01) 만 90일을 넘겼다; hcmc-b 는 색인이 아니라 정체가 아니다.
  assert.deepEqual(s.staleUrls.sort(), [U('hcmc-c'), U('hcmc-d')].sort());
  assert.equal(s.byKind.posts.n, 5);
  assert.equal(s.byKind.essentials.indexed, 1);
  // 코호트: treatment 둘 중 a 만 10-28 이후 재크롤; control 은 베트남 posts 중 그룹 밖 c·d(둘 다 재크롤 없음).
  assert.equal(s.cohort.firsthand.n, 2);
  assert.equal(s.cohort.firsthand.recrawled, 1);
  assert.equal(s.cohort.control.n, 2);
  assert.equal(s.cohort.control.recrawled, 0);
  assert.deepEqual(s.cohort.control.countries, ['Vietnam']);
  // 미국 글은 그룹 나라가 아니라 비교군이 아니다; 허브는 posts 가 아니라 비교군이 아니다.
  assert.equal(s.cohort.firsthand.newlyIndexed, 0);
});

test('summarize: a group given as Map counts only crawls after each URL’s own change date', () => {
  // a 는 11-10 에 크롤됐지만 사진은 11-12 에 들어갔다 → 성과 아님. c 는 06-15 에 바뀌었고 07-01 크롤 → 성과.
  const photoRefresh = new Map([[U('hcmc-a'), '2026-11-12'], [U('hcmc-c'), '2026-06-15']]);
  const s = summarize(rows, { today: TODAY, cohortStart: START, groups: { photoRefresh } });
  assert.equal(s.cohort.photoRefresh.n, 2);
  assert.equal(s.cohort.photoRefresh.recrawled, 1);
  // 비교군은 그룹 밖 베트남 posts(b·d), 시작일은 공통 cohortStart.
  assert.equal(s.cohort.control.n, 2);
});

test('summarize: fixed:false members are inspected for cohorts but kept out of the rates', () => {
  const withExtra = [...rows, { url: U('hcmc-new'), kind: 'posts', country: 'Vietnam', fixed: false, coverageState: 'URL is unknown to Google', lastCrawlTime: null, impressions: 0 }];
  const s = summarize(withExtra, { today: TODAY, cohortStart: START, groups: { firsthand: new Map([[U('hcmc-new'), '2026-11-01']]) } });
  assert.equal(s.n, 6);          // 분모는 고정 집합뿐
  assert.equal(s.extra, 1);
  assert.equal(s.indexedRate, 5 / 6);
  assert.equal(s.cohort.firsthand.n, 1);
  assert.equal(s.cohort.firsthand.recrawled, 0);
  assert.equal(s.cohort.control.n, 4); // 베트남 고정 posts a·b·c·d
});

test('summarize: gained/lost compare against the previous run, not the baseline', () => {
  const prev = new Map([
    [U('hcmc-b'), { coverageState: 'Submitted and indexed' }],
    [U('hcmc-c'), { coverageState: 'Discovered - currently not indexed' }],
  ]);
  const s = summarize(rows, { today: TODAY, prev });
  assert.deepEqual(s.gained, [U('hcmc-c')]);
  assert.deepEqual(s.lost, [U('hcmc-b')]);
});

test('judgeCohort applies the pre-registered line and nothing else', () => {
  const t = { judgeOn: '2026-12-09', group: 'firsthand', recrawlRatio: 2, minNewlyIndexed: 1 };
  const s = summarize(rows, { today: TODAY, cohortStart: START, groups, baseline });
  assert.equal(judgeCohort(s, t, '2026-12-01').key, 'tooEarly');
  // 치료군 50% vs 비교군 0% 이지만 전환 0건 → 합격 아님.
  assert.equal(judgeCohort(s, t, '2026-12-09').key, 'noEffect');
  // b 가 색인되면(기준선에선 미색인) 전환 1건 → 확대.
  const won = rows.map((r) => (r.url === U('hcmc-b') ? { ...r, coverageState: 'Submitted and indexed', lastCrawlTime: '2026-11-18T00:00:00Z' } : r));
  assert.equal(judgeCohort(summarize(won, { today: TODAY, cohortStart: START, groups, baseline }), t, '2026-12-09').key, 'expand');
  // 양쪽 다 재크롤 0 이면 측정 불가 — 결론이 아니라 실험 종료.
  const dead = rows.map((r) => ({ ...r, lastCrawlTime: '2026-09-01T00:00:00Z' }));
  assert.equal(judgeCohort(summarize(dead, { today: TODAY, cohortStart: START, groups, baseline }), t, '2026-12-09').key, 'unmeasurable');
  assert.equal(judgeCohort(s, { ...t, group: 'photoRefresh' }, '2026-12-09').key, 'unmeasured');
});

test('formatReport is Korean, carries the numbers, and flags a mostly-failed run', () => {
  const s = summarize(rows, { today: TODAY, cohortStart: START, groups, baseline });
  const text = formatReport(s, { at: '2026-11-20T21:41:00Z', thresholds: { judgeOn: '2026-12-09' } });
  assert.match(text, /핵심 집합/);
  assert.match(text, /고정 집합 6쪽 · 색인 83%\(5\)/);
  assert.match(text, /정체\(90일\+ 미재크롤\) 2쪽/);
  assert.match(text, /코호트\(2026-10-28 시작, 바뀐 날 이후 크롤만\): 직접경험 1\/2 재크롤\(50%\) · 비교군 0\/2/);
  assert.match(text, /판정일 2026-12-09/);
  assert.doesNotMatch(text, /측정 불완전/);
  const mostlyFailed = summarize(rows.map((r, i) => (i < 3 ? { ...r, error: true } : r)), { today: TODAY });
  assert.match(formatReport(mostlyFailed, { at: '2026-11-20' }), /측정 불완전/);
});
