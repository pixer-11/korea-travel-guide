// pinterest-analytics 회귀 테스트 — API 응답 방어적 해석과 한국어 요약 문구를 고정.
//
//   node --test scripts/pinterest-analytics.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSummary, summarize } from './pinterest-analytics.mjs';

test('요약 지표: all.summary_metrics 표준 모양', () => {
  const body = { all: { summary_metrics: { IMPRESSION: 120, SAVE: 3, PIN_CLICK: 9, OUTBOUND_CLICK: 2 } } };
  assert.deepEqual(extractSummary(body), { impressions: 120, saves: 3, pinClicks: 9, outboundClicks: 2 });
});

test('요약 지표: 모양이 달라도(중첩 없음·누락 키) 0으로 방어', () => {
  assert.deepEqual(extractSummary({ summary_metrics: { IMPRESSION: 5 } }),
    { impressions: 5, saves: 0, pinClicks: 0, outboundClicks: 0 });
  assert.deepEqual(extractSummary({}), { impressions: 0, saves: 0, pinClicks: 0, outboundClicks: 0 });
  assert.deepEqual(extractSummary(null), { impressions: 0, saves: 0, pinClicks: 0, outboundClicks: 0 });
});

test('주간 요약: 합계·상위 핀·나라별이 들어간다', () => {
  const pins = [
    { slug: 'a', country: 'Japan', impressions: 100, saves: 1, pinClicks: 5, outboundClicks: 2 },
    { slug: 'b', country: 'Japan', impressions: 40, saves: 0, pinClicks: 1, outboundClicks: 0 },
    { slug: 'c', country: 'France', impressions: 0, saves: 0, pinClicks: 0, outboundClicks: 0 },
  ];
  const s = summarize(pins, { start: '2026-07-26', end: '2026-08-25' });
  assert.match(s, /핀 3개: 노출 140 · 저장 1 · 핀 클릭 6 · 사이트 방문 2/);
  assert.match(s, /노출이 있었던 핀: 2\/3/);
  assert.match(s, /• a — 노출 100 · 방문 2/);
  assert.match(s, /나라별 노출: Japan 140/);
  assert.ok(!s.includes('France'), '노출 0인 나라는 표시하지 않는다');
});

test('주간 요약: 전부 0이면 신규 계정 문턱 안내가 나온다(경보 아님)', () => {
  const s = summarize([{ slug: 'a', impressions: 0, saves: 0, pinClicks: 0, outboundClicks: 0 }], { start: 's', end: 'e' });
  assert.match(s, /아직 노출된 핀이 없습니다/);
  assert.match(s, /정상입니다/);
});
