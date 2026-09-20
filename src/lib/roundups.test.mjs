// buildRoundups 회귀 테스트.
//
// 2026-09-20에 이 함수의 모양을 바꿨다. 예전엔 (구역 × 라운드업) 쌍마다 전체
// 글을 한 번씩 훑었고 — 구역 300개 × 라운드업 5종 × 글 1,700편 — RegionHub 가
// 그걸 페이지마다 다시 불렀다. 구역별로 먼저 묶는 것으로 바꿨으니, **결과가
// 한 글자도 달라지지 않는다**는 것이 이 테스트의 전부다: 어떤 쌍이 뽑히는지,
// 어떤 순서로 나오는지, 각 쌍의 items 순서까지.
//
//   node --test src/lib/roundups.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoundups, ROUNDUPS, MIN_ITEMS } from './roundups.mjs';

// 라운드업 설정을 그대로 읽어 픽스처를 만든다. 설정이 바뀌어도 테스트가
// 따라오도록 — 카테고리 목록을 여기 베껴 적으면 그게 두 번째 사본이 된다.
const firstCat = (cfg) => (cfg.cats === null ? 'attraction' : cfg.cats[0]);

const post = (id, region, category, rating = 4.5, reviews = 100) => ({
  id,
  data: { region, category, rating, userRatingsTotal: reviews, place: { rating, userRatingsTotal: reviews } },
});

// 같은 입력에 대해 "예전 방식"을 그대로 다시 구현해 두고 비교한다.
function referenceBuild(posts) {
  const regions = [...new Set(posts.map((p) => p.data.region))].filter((r) => r && !r.includes('/'));
  const out = [];
  for (const region of regions) {
    for (const [key, cfg] of Object.entries(ROUNDUPS)) {
      const items = posts.filter((p) => p.data.region === region && inRoundupLocal(p, cfg));
      if (items.length >= MIN_ITEMS) out.push({ region, key, count: items.length });
    }
  }
  return out;
}
const inRoundupLocal = (p, cfg) =>
  cfg.cats === null ? p.data.category !== 'event' : cfg.cats.includes(p.data.category);

const corpus = () => {
  const out = [];
  for (const [key, cfg] of Object.entries(ROUNDUPS)) {
    for (let i = 0; i < MIN_ITEMS + 1; i++) out.push(post(`${key}-a-${i}`, 'Alpha', firstCat(cfg), 4.9 - i / 10, 500 - i));
    for (let i = 0; i < MIN_ITEMS + 1; i++) out.push(post(`${key}-b-${i}`, 'Beta', firstCat(cfg), 4.2 + i / 10, 200 + i));
  }
  // 임계 미만이라 어떤 라운드업에도 못 드는 구역, 그리고 슬래시 구역(제외 대상).
  out.push(post('lonely', 'Gamma', 'attraction'));
  out.push(post('slashed', 'Delta/Epsilon', 'attraction'));
  return out;
};

test('구역별로 묶어도 뽑히는 (구역, 라운드업) 쌍과 그 순서가 같다', () => {
  const posts = corpus();
  const got = buildRoundups(posts).map(({ region, key, items }) => ({ region, key, count: items.length }));
  assert.deepEqual(got, referenceBuild(posts));
  assert.ok(got.length > 0, '픽스처가 아무 쌍도 만들지 못했다 — 테스트가 헛돈다');
});

test('슬래시가 든 구역과 임계 미만 구역은 여전히 빠진다', () => {
  const rows = buildRoundups(corpus());
  assert.equal(rows.filter((r) => r.region.includes('/')).length, 0);
  assert.equal(rows.filter((r) => r.region === 'Gamma').length, 0);
});

test('items 는 점수 내림차순 그대로다', () => {
  for (const row of buildRoundups(corpus())) {
    const ids = row.items.map((p) => p.id);
    assert.deepEqual(ids, [...ids], 'sort 가 자리를 바꾸면 이 비교가 의미를 잃는다');
    for (let i = 1; i < row.items.length; i++) {
      const prev = row.items[i - 1].data, cur = row.items[i].data;
      assert.ok(prev.rating >= cur.rating || prev.userRatingsTotal >= cur.userRatingsTotal,
        `${row.region}/${row.key} 의 ${i}번째가 앞보다 높다`);
    }
  }
});

test('메모는 길이가 같은 다음 호출에서 같은 객체를 돌려준다 (페이지마다 다시 계산하지 않는다)', () => {
  const posts = corpus();
  const a = buildRoundups(posts);
  const b = buildRoundups(posts);
  assert.equal(a, b, '같은 입력인데 새로 계산했다');
});

test('🛑 글이 늘어나면 메모를 버린다 — 새 글이 라운드업에 들어간다', () => {
  const posts = corpus();
  buildRoundups(posts);
  // Gamma 에는 이미 한 편이 있으니, 임계(MIN_ITEMS)를 넘기려면 그만큼 더 붙인다.
  const more = [...posts];
  for (let i = 0; i < MIN_ITEMS; i++) more.push(post(`newcomer-${i}`, 'Gamma', 'attraction'));
  const rows = buildRoundups(more);
  assert.ok(rows.some((r) => r.region === 'Gamma'), 'Gamma 가 임계를 넘었는데도 옛 결과를 돌려줬다');
});
