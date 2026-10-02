// 빙 "죽은 노출" 가드 — 막아야 할 때 막고, 정상까지 막지는 않는지 (2026-09-21).
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeadQuery, queryLang, bingSplit, deadQuerySet } from './bing-dead-queries.mjs';

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

// 2026-10-02: 빙은 같은 검색어를 주마다 한 줄씩 준다. 행만 보면 꺼져 가는 주가 샌다.
const VENICE = (imp, extra = {}) => ({ Query: '威尼斯大运河', Impressions: imp, Clicks: 0, AvgImpressionPosition: 9, ...extra });

test('죽은 검색어가 주 250회 밑으로 내려와도 실질로 넘어오지 않는다', () => {
  const rows = [VENICE(459), VENICE(563), VENICE(332), VENICE(172),
    { Query: '北京中国网球公开赛', Impressions: 60, Clicks: 9, AvgImpressionPosition: 3 }];
  assert.equal(isDeadQuery(VENICE(172)), false, '행 하나만 보면 172 는 살아 있다 — 그게 구멍이었다');
  const s = bingSplit(rows);
  assert.equal(s.dead.n, 4, '네 주 전부');
  assert.equal(s.dead.queries, 1, '사람에게 말할 숫자는 검색어 1개');
  assert.equal(s.dead.imp, 459 + 563 + 332 + 172);
  assert.deepEqual(s.liveRows.map((x) => x.Query), ['北京中国网球公开赛']);
  assert.equal(s.byLang.find((x) => x.lang === '중국어').imp, 60, '172 가 중국어 CTR 을 희석하지 않는다');
});

test('다른 주에 실제로 눌린 검색어는 통째로 버리지 않는다', () => {
  // 한 주는 6,000노출·클릭 0(그 행은 뺀다), 다른 주는 100노출·클릭 50 — 합치면 CTR 0.8%.
  const rows = [{ Query: 'q', Impressions: 6000, Clicks: 0, AvgImpressionPosition: 3 },
    { Query: 'q', Impressions: 100, Clicks: 50, AvgImpressionPosition: 2 }];
  assert.equal(deadQuerySet(rows).has('q'), false);
  const s = bingSplit(rows);
  assert.equal(s.dead.n, 1);
  assert.equal(s.live.clicks, 50, '실제 클릭 50 은 실질에 남는다');
});

test('한 번도 큰 주가 없던 검색어는 건드리지 않는다 — 새 부류를 제외하지 않는다', () => {
  // 주 100회씩 다섯 주·클릭 0: 합치면 500 이지만 어느 주도 죽은 판정이 아니었다.
  const rows = Array.from({ length: 5 }, () => ({ Query: '볼로냐 여행', Impressions: 100, Clicks: 0, AvgImpressionPosition: 7 }));
  assert.equal(deadQuerySet(rows).size, 0);
  assert.equal(bingSplit(rows).live.imp, 500);
});

test('같은 뜻의 다른 언어 검색어는 따로 판정한다 (문자열이 같아야 같은 검색어)', () => {
  const rows = [VENICE(459), { Query: 'gran canal de venecia', Impressions: 172, Clicks: 0, AvgImpressionPosition: 9 }];
  assert.deepEqual([...deadQuerySet(rows)], ['威尼斯大运河']);
});

test("실질 행 목록은 펼칠 수 있고 죽은 검색어를 담지 않는다", () => {
  // 리포트가 상위 검색어를 뽑을 때 이 목록을 펼친다. 합계 묶음(live)을 펼치면 터진다.
  const s = bingSplit([HUGE_ZERO, { Query: "a", Impressions: 100, Clicks: 5, AvgImpressionPosition: 3 }]);
  assert.equal(Array.isArray(s.liveRows), true);
  assert.deepEqual([...s.liveRows].map((x) => x.Query), ["a"]);
  assert.throws(() => [...s.live], TypeError, "합계 묶음은 목록이 아니다");
});
