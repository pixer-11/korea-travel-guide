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
