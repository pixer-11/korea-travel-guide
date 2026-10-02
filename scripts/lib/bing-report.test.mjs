// The Bing block of the daily report — dated, weekly, and led by the number that moves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bingDate, bingDaily, bingLines } from './bing-report.mjs';

const DAY = 86_400_000;
const at = (iso) => `/Date(${Date.parse(`${iso}T00:00:00Z`)})/`;
const q = (Query, week, Impressions, Clicks, AvgImpressionPosition = 3) => ({ Query, Date: at(week), Impressions, Clicks, AvgImpressionPosition });

// Bundles are labelled by the day AFTER the week they cover: 09-25 = 09-18…09-24.
const ROWS = [
  // three weeks old: a concert query nobody has searched since — it led "top" for three weeks
  q('aaron kwok - iconic world tour at axiata arena', '2026-09-11', 559, 1, 9),
  // a dead query, fading: 563 → 172. The 172 used to leak into "live" and into "top".
  q('威尼斯大运河', '2026-09-18', 563, 0, 9),
  q('威尼斯大运河', '2026-09-25', 172, 0, 9),
  q('北京中国网球公开赛', '2026-09-18', 40, 20, 2),
  q('北京中国网球公开赛', '2026-09-25', 60, 28, 2),
  q('西安斯诺克', '2026-09-25', 30, 20, 4),
  q('デリー旅行', '2026-09-18', 50, 18, 3),
  q('デリー旅行', '2026-09-25', 55, 21, 3),
  q('garlic naan near me', '2026-09-25', 12, 2, 8),
];
const daily = (from, clicks) => clicks.map((c, i) => ({ Date: `/Date(${Date.parse(`${from}T00:00:00Z`) + i * DAY}-0700)/`, Clicks: c, Impressions: c * 70 }));
const DAILY = daily('2026-09-16', [20, 22, 25, 24, 26, 25, 25, 23, 24, 28, 22, 30, 36, 38]);

test('Bing dates parse, with or without a timezone tail', () => {
  assert.equal(bingDate({ Date: '/Date(1787875200000)/' }), 1787875200000);
  assert.equal(bingDate({ Date: '/Date(1787875200000-0700)/' }), 1787875200000);
  assert.equal(bingDate({ Date: 'yesterday' }), null);
  assert.equal(bingDate({}), null);
});

test('daily clicks lead, with the date they run to and the week before', () => {
  const d = bingDaily(DAILY);
  assert.equal(d.last.clicks, 23 + 24 + 28 + 22 + 30 + 36 + 38);
  assert.equal(d.prev.clicks, 20 + 22 + 25 + 24 + 26 + 25 + 25);
  const L = bingLines(ROWS, DAILY);
  assert.equal(L[0], '🅱️ 빙 검색');
  assert.match(L[1], /일별 총계\(09-29까지 — 빙 집계는 3~4일 늦습니다\): 최근 7일 클릭 201 · 직전 7일 167 \(\+20%\)/);
});

test('unsorted daily rows give the same answer; fewer than a week gives none', () => {
  assert.deepEqual(bingDaily([...DAILY].reverse()), bingDaily(DAILY));
  assert.equal(bingDaily(DAILY.slice(0, 6)), null);
  assert.equal(bingDaily(null), null);
  const eight = bingDaily(DAILY.slice(-8));
  assert.equal(eight.prev, null, 'no half-week comparison');
  assert.doesNotMatch(bingLines(ROWS, DAILY.slice(-8))[1], /직전 7일/);
});

test('when the daily call failed the block still stands, without that line', () => {
  const L = bingLines(ROWS, null);
  assert.equal(L[0], '🅱️ 빙 검색');
  assert.match(L[1], /^ {3}└ 검색어 목록/);
});

test('the query list says how old it is and that its CTR is not the site\'s', () => {
  const line = bingLines(ROWS, DAILY).find((l) => l.includes('검색어 목록'));
  assert.match(line, /주 1회 갱신 · 09-24까지 누적/);
  assert.match(line, /사이트 전체 CTR 아님/);
});

test('a dead query is counted once, however many weeks it spans, and never reaches "top"', () => {
  const L = bingLines(ROWS, DAILY);
  const dead = L.find((l) => l.includes('한 번도 안 눌린'));
  assert.match(dead, /검색어 1개\(노출 735\)/);
  const top = L.find((l) => l.includes('클릭 상위'));
  assert.doesNotMatch(top, /威尼斯大运河/);
});

test('"top" comes from the newest week only — an old bundle cannot lead it', () => {
  const top = bingLines(ROWS, DAILY).find((l) => l.includes('클릭 상위'));
  assert.doesNotMatch(top, /aaron kwok/, '559 impressions, but three weeks ago');
  assert.match(top, /^ {3}└ 최신 주 클릭 상위: 北京中国网球公开赛 클릭 28·노출 60·2위 · デリー旅行 클릭 21·노출 55·3위 · 西安斯诺克 클릭 20·노출 30·4위$/);
});

test('"top" is ranked by clicks — by impressions it was three queries nobody clicked', () => {
  const rows = [q('天后宮 クアラルンプール', '2026-09-25', 245, 0, 6), q('볼로냐 여행', '2026-09-25', 111, 0, 7),
    q('ニューデリー サフダルジャング廟', '2026-09-25', 40, 3, 2), q('garlic naan near me', '2026-09-25', 12, 3, 8)];
  const top = bingLines(rows, null).find((l) => l.includes('클릭 상위'));
  assert.match(top, /클릭 상위: ニューデリー サフダルジャング廟 클릭 3·노출 40·2위 · garlic naan near me 클릭 3·노출 12·8위$/);
  // A week where nothing was clicked prints no such line rather than a list of zeros.
  assert.equal(bingLines(rows.slice(0, 2), null).some((l) => l.includes('클릭 상위')), false);
});

test('languages are compared by clicks, newest week against the one before', () => {
  const line = bingLines(ROWS, DAILY).find((l) => l.includes('언어별 클릭'));
  assert.match(line, /최신 주\(09-18~09-24\) · 괄호는 직전 주: 중국어 48\(20\) · 일본어 21\(18\) · 라틴 2\(0\)/);
  assert.doesNotMatch(line, /%/, 'ratios over a hundred impressions were what misled');
});

test('page-one count is the newest week\'s, not five weeks added up', () => {
  const line = bingLines(ROWS, DAILY).find((l) => l.includes('5위 안'));
  assert.match(line, /최신 주 5위 안 검색어 3개\(노출 145\)/);
});

test('rows without dates still report, just not by week', () => {
  const L = bingLines(ROWS.map(({ Date: _d, ...r }) => r), null);
  assert.match(L.find((l) => l.includes('검색어 목록')), /\(주 1회 갱신\)/);
  assert.match(L.find((l) => l.includes('언어별 클릭')), /^ {3}└ 언어별 클릭: /);
  assert.match(L.find((l) => l.includes('클릭 상위')), /^ {3}└ 클릭 상위: /);
});

test('only one week on record: no "week before" is invented', () => {
  const L = bingLines(ROWS.filter((r) => r.Date === at('2026-09-25')), null);
  assert.doesNotMatch(L.find((l) => l.includes('언어별 클릭')), /괄호/);
});

test('no rows, no block', () => {
  assert.deepEqual(bingLines([], DAILY), []);
  assert.deepEqual(bingLines(null, null), []);
});
