// 빙 "죽은 노출" 가드 — 막아야 할 때 막고, 정상까지 막지는 않는지 (2026-09-21).
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeadQuery, queryLang, bingSplit } from './bing-dead-queries.mjs';

// 그날 실측한 모양 그대로. 3위에서 6,147회 노출에 클릭 0.
const HUGE_ZERO = { Query: '马来西亚吉隆坡天后宫', Impressions: 6147, Clicks: 0, AvgImpressionPosition: 3 };

test('큰 노출에 클릭 0이면 뺀다', () => {
  assert.equal(isDeadQuery(HUGE_ZERO), true);
  assert.equal(isDeadQuery({ Impressions: 590, Clicks: 0, AvgImpressionPosition: 8 }), true);
});

test('클릭 한 번이 6천 노출을 되살리지 못한다', () => {
  assert.equal(isDeadQuery({ ...HUGE_ZERO, Clicks: 1 }), true, 'CTR 0.02% 는 여전히 죽은 것이다');
  // 반대로 CTR 이 0.1% 를 넘으면 살린다 — 실제로 559노출·1클릭(0.18%)인 검색어가 있었다.
  assert.equal(isDeadQuery({ Impressions: 559, Clicks: 1, AvgImpressionPosition: 9 }), false);
});

test('작은 검색어의 클릭 0 은 흔한 일이라 건드리지 않는다', () => {
  assert.equal(isDeadQuery({ Impressions: 249, Clicks: 0, AvgImpressionPosition: 3 }), false);
  assert.equal(isDeadQuery({ Impressions: 12, Clicks: 0, AvgImpressionPosition: 30 }), false);
});

test('일본어 질의를 중국어로 세지 않는다 — 한자가 섞여 있다', () => {
  assert.equal(queryLang('デリー旅行'), '일본어');
  assert.equal(queryLang('意大利博洛尼亚主广场'), '중국어');
  assert.equal(queryLang('이탈리아 베로나 아레나'), '한국어');
  assert.equal(queryLang('garlic naan near me'), '라틴');
});

test('실질 수치가 죽은 덩어리에 희석되지 않는다', () => {
  const rows = [HUGE_ZERO,
    { Query: 'デリー旅行', Impressions: 100, Clicks: 12, AvgImpressionPosition: 3 },
    { Query: 'garlic naan near me', Impressions: 100, Clicks: 5, AvgImpressionPosition: 4 }];
  const s = bingSplit(rows);
  assert.equal(s.dead.n, 1);
  assert.equal(s.dead.imp, 6147);
  assert.equal(s.live.imp, 200);
  assert.equal(Math.round(s.live.ctr * 100), 9, '섞어 세면 0.3% 로 보인다');
  // 제목이 값을 하는 자리에도 죽은 것이 끼면 안 된다 (그날 8,579 중 7,900 이 죽은 것이었다).
  assert.equal(s.pageOne.every((x) => x.Clicks > 0 || x.Impressions < 250), true);
});

test('죽은 것이 없으면 전부 실질이고 경고도 없다', () => {
  const s = bingSplit([{ Query: 'a', Impressions: 100, Clicks: 5, AvgImpressionPosition: 3 }]);
  assert.equal(s.dead.n, 0);
  assert.equal(s.live.n, 1);
});

test('빈 입력에도 터지지 않는다', () => {
  for (const v of [[], null, undefined]) {
    const s = bingSplit(v);
    assert.equal(s.live.imp, 0);
    assert.equal(s.live.ctr, 0);
  }
});
