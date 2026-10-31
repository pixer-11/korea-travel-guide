import test from 'node:test';
import assert from 'node:assert/strict';
import { pickBotClusters, clusterFilter, excludeClusters, describeCluster, detectBotClusters, confirmNoCity, CLUSTER_DIMS } from './plausible-bot-cluster.mjs';

// 실제 응답 모양 그대로 — 공개 대시보드 query, CLUSTER_DIMS 순서, metrics [visitors, pageviews, bounce, duration].
const row = (dims, v, pv, b, d) => ({ dimensions: dims, metrics: [v, pv, b, d] });

// 2026-10-30: 466명 중 367명이 한 조합.
const D1030 = [
  row(['CN', 'Chrome', '151.0', 'Windows', 'Desktop', 'Direct / None'], 367, 416, 77, 7),
  row(['JP', 'Microsoft Edge', '156.0', 'Windows', 'Desktop', 'Bing'], 13, 16, 62, 51),
  row(['CN', 'Microsoft Edge', '156.0', 'Windows', 'Desktop', 'Bing'], 11, 20, 73, 95),
];
// 2026-10-23: 빙 앱 유입 급증(퀸스타운) — 실제 사람. 최대 조합 67/420.
const D1023 = [
  row(['MX', 'Mobile App', '155.0', 'Android', 'Mobile', 'Direct / None'], 67, 73, 81, 14),
  row(['ES', 'Mobile App', '155.0', 'Android', 'Mobile', 'Direct / None'], 27, 27, 96, 0),
  row(['MX', 'Mobile App', '(not set)', 'iOS', 'Mobile', 'Bing'], 19, 20, 79, 1),
];
// 2026-10-27: 평범한 날 — 같은 지문이 9명뿐.
const D1027 = [
  row(['JP', 'Microsoft Edge', '156.0', 'Windows', 'Desktop', 'Bing'], 13, 13, 85, 2),
  row(['CN', 'Chrome', '151.0', 'Windows', 'Desktop', 'Direct / None'], 9, 9, 89, 0),
];

test('the 10-29/30 shape is caught: one Direct combo owning the day, short visits', () => {
  const c = pickBotClusters(D1030, 466);
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].values, ['CN', 'Chrome', '151.0', 'Windows', 'Desktop', 'Direct / None']);
  assert.equal(c[0].visitors, 367);
  assert.equal(describeCluster(c[0]), '중국·Chrome 151·Windows·직접 유입');
});

test('a real search surge is NOT caught (10-23 Queenstown via the Bing app)', () => {
  // 'Mobile App' 은 리퍼러를 지워 '직접'으로 보이고, 몫도 16% 뿐이다.
  assert.deepEqual(pickBotClusters(D1023, 420), []);
  // 앱이 아니었어도 몫(16%)이 문턱 아래라 안 잡힌다.
  const notApp = D1023.map((r) => ({ ...r, dimensions: r.dimensions.map((v) => (v === 'Mobile App' ? 'Chrome Mobile' : v)) }));
  assert.deepEqual(pickBotClusters(notApp, 420), []);
});

test('a quiet day with the same fingerprint is left alone (too small to reason about)', () => {
  assert.deepEqual(pickBotClusters(D1027, 133), []);
});

test('each guard holds on its own', () => {
  const base = ['CN', 'Chrome', '151.0', 'Windows', 'Desktop', 'Direct / None'];
  // 검색에서 온 덩어리는 사람의 쏠림일 수 있다.
  assert.deepEqual(pickBotClusters([row(base.with(5, 'Bing'), 300, 320, 77, 7)], 400), []);
  // 오래 머문 덩어리는 사람일 수 있다.
  assert.deepEqual(pickBotClusters([row(base, 300, 320, 40, 95)], 400), []);
  // (not set) 은 필터로 정확히 뺄 수 없다 — 잘못 빼느니 남긴다.
  assert.deepEqual(pickBotClusters([row(base.with(2, '(not set)'), 300, 320, 77, 7)], 400), []);
  // 0 명인 날·빈 응답.
  assert.deepEqual(pickBotClusters(D1030, 0), []);
  assert.deepEqual(pickBotClusters(null, 466), []);
});

test('the exclusion filter is not(and(is …)) over every dimension, in order', () => {
  const [c] = pickBotClusters(D1030, 466);
  const f = clusterFilter(c);
  assert.equal(f[0], 'and');
  assert.equal(f[1].length, CLUSTER_DIMS.length);
  assert.deepEqual(f[1][2], ['is', 'visit:browser_version', ['151.0']]);
  assert.deepEqual(excludeClusters([c]), [['not', f]]);
  assert.deepEqual(excludeClusters([]), []);
});

// 조회 흉내: 전체·조합·도시 없음 세 가지 질문에 그날의 실제 값으로 답한다.
const fake = (rows, total, noCity) => async (body) => {
  if (body.dimensions) return rows;
  if (body.filters?.some((f) => f[0] === 'is' && f[1] === 'visit:city_name')) return [{ dimensions: [], metrics: [noCity] }];
  return [{ dimensions: [], metrics: [total] }];
};

test('detectBotClusters never removes anything it could not see', async () => {
  const failing = async () => { throw new Error('Plausible public 500'); };
  const r = await detectBotClusters(failing);
  assert.deepEqual(r.clusters, []);
  assert.match(r.error, /500/);
  // 200 인데 결과가 비었다 — '덩어리 없음'이 아니라 '못 봤다'.
  const empty = await detectBotClusters(async () => []);
  assert.deepEqual(empty.clusters, []);
  assert.match(empty.error, /집계 행이 없다/);
});

test('the second witness: a candidate is removed only when most of it has no city', async () => {
  // 10-30 실측: 367 중 320 도시 없음(87%) → 뺀다.
  const bot = await detectBotClusters(fake(D1030, 466, 320));
  assert.equal(bot.total, 466);
  assert.equal(bot.clusters.length, 1);
  assert.equal(bot.clusters[0].noCity, 320);
  // 같은 모양이라도 도시가 찍힌 사람들(예: 직접 공유 링크로 몰린 크롬 데스크톱 150명) → 안 뺀다.
  const people = await detectBotClusters(fake(D1030, 466, 30));
  assert.equal(people.candidates, 1);
  assert.deepEqual(people.clusters, []);
  assert.deepEqual(confirmNoCity([{ visitors: 100 }], [49]), []);
  assert.equal(confirmNoCity([{ visitors: 100 }], [50]).length, 1);
});
