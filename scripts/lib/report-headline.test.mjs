import test from 'node:test';
import assert from 'node:assert/strict';
import { headlineLines } from './report-headline.mjs';

const pl = { visitors: 41, pageviews: 63 };
const cf = { visits: 269, pageviews: 301 };

test('real visitors lead; all traffic sits under it, named for what it is', () => {
  const L = headlineLines(cf, pl);
  assert.match(L[0], /^👥 실제 방문자 41명 · 페이지뷰 63$/);
  assert.match(L[1], /전체 접속\(봇·본인 포함\) 269회 · 페이지뷰 301$/);
  assert.equal(L.length, 2);
});

test('the wrong reason is gone: the gap is not explained as ad blockers', () => {
  const all = [headlineLines(cf, pl), headlineLines(cf, null), headlineLines(null, pl)].flat().join('\n');
  assert.doesNotMatch(all, /광고차단/);
});

test('a bot wave is flagged on the all-traffic line, not the headline', () => {
  // 09-18: 7,498 visits, 7,508 pageviews, 41 people.
  const L = headlineLines({ visits: 7498, pageviews: 7508 }, pl);
  assert.match(L[0], /^👥 실제 방문자 41명/);
  assert.match(L[1], /7,498회.*⚠️ 자동 접속 급증$/);
  assert.match(L[2], /사람이 아닌 접속\(봇·자동 검사\)으로 크게 부풀었습니다/);
});

test('the flag names the shape, not a culprit — 10-01 was our own checks, not bots', () => {
  // 2,688 visits, 2,863 pageviews, 45 readers: four runner runs and the desk's.
  const all = headlineLines({ visits: 2688, pageviews: 2863 }, { visitors: 45, pageviews: 53 }).join('\n');
  assert.match(all, /자동 접속 급증/);
  assert.doesNotMatch(all, /봇 급증|봇으로 크게/);
});

test('either collector failing says which number is missing', () => {
  const noPl = headlineLines(cf, null);
  assert.match(noPl[0], /^👥 전체 접속 269회/);
  assert.match(noPl[1], /실제 방문자\(Plausible\) 수집 실패 — 위 숫자는 봇과 본인 접속이 섞인 값/);
  const noCf = headlineLines(null, pl);
  assert.match(noCf[0], /^👥 실제 방문자 41명/);
  assert.match(noCf[1], /전체 접속\(Cloudflare\) 수집 실패/);
  assert.deepEqual(headlineLines(null, null), []);
});

test('a cluster Plausible itself counted is named under the headline, which already excludes it', () => {
  // 10-30: 466 counted, 367 of them one Chrome build from China; 99 people left.
  const cluster = { values: ['CN', 'Chrome', '151.0', 'Windows', 'Desktop', 'Direct / None'], visitors: 367, pageviews: 416, bounce: 77, duration: 7 };
  const L = headlineLines({ visits: 1830, pageviews: 1852 }, { visitors: 99, pageviews: 140, botClusters: [cluster], botRemoved: 367 });
  assert.match(L[0], /^👥 실제 방문자 99명 · 페이지뷰 140$/);
  assert.match(L[1], /🤖 자동 접속 의심 367명은 뺐습니다\(중국·Chrome 151·Windows·직접 유입 — 그 조합 367명, 평균 7초\)/);
  // 뺀 수는 머리 숫자의 전후 차이를 쓴다(조합 수의 합은 겹칠 수 있다).
  const overlap = headlineLines(null, { visitors: 99, pageviews: 140, botClusters: [cluster, { ...cluster, values: cluster.values.with(2, '150.0'), visitors: 120 }], botRemoved: 470 });
  assert.match(overlap[1], /자동 접속 의심 470명은 뺐습니다/);
  assert.match(L[2], /전체 접속\(봇·본인 포함\) 1,830회/);
  // 사람 99명 대비 접속 1,830회면 Cloudflare 줄의 급증 표시도 켜진다 — 두 표시가 같은 날을 같은 말로 설명한다.
  assert.match(L[2], /자동 접속 급증/);
  // 덩어리가 없는 날은 줄이 늘지 않는다.
  assert.equal(headlineLines(cf, { ...pl, botClusters: [] }).length, 2);
});
