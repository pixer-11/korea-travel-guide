import test from 'node:test';
import assert from 'node:assert/strict';
import { pickFeatured, groupByCity, weekKey } from './featuredItineraries.mjs';

const it = (city, days) => ({ id: `${city.toLowerCase().replace(/\s+/g, '-')}-${days}-days`, data: { city, days } });
const CORPUS = [
  it('Bangkok', 3), it('Barcelona', 3), it('Busan', 3), it('Hong Kong', 3), it('Hong Kong', 5),
  it('New York', 3), it('Seoul', 3), it('Singapore', 3), it('Singapore', 5), it('Tokyo', 3),
];
const PINNED = ['Tokyo', 'Bangkok', 'Seoul'];

test('한 도시 한 행 — 홍콩 3일+5일이 한 그룹, 짧은 코스가 먼저', () => {
  const g = groupByCity(CORPUS).find((x) => x.city === 'Hong Kong');
  assert.equal(g.courses.length, 2);
  assert.deepEqual(g.courses.map((c) => c.data.days), [3, 5]);
});

test('고정 3 + 회전 2 = 5행, 고정은 지정 순서 그대로 맨 앞', () => {
  const out = pickFeatured(CORPUS, { pinned: PINNED, rotate: 2, week: 0 });
  assert.equal(out.length, 5);
  assert.deepEqual(out.slice(0, 3).map((g) => g.city), PINNED);
  assert.ok(!out.slice(3).some((g) => PINNED.includes(g.city)));
});

test('같은 주에는 같은 결과, 다른 주에는 회전 슬롯이 바뀐다', () => {
  const a = pickFeatured(CORPUS, { pinned: PINNED, rotate: 2, week: 10 });
  const b = pickFeatured(CORPUS, { pinned: PINNED, rotate: 2, week: 10 });
  const c = pickFeatured(CORPUS, { pinned: PINNED, rotate: 2, week: 11 });
  assert.deepEqual(a.map((g) => g.city), b.map((g) => g.city));
  assert.notDeepEqual(a.slice(3).map((g) => g.city), c.slice(3).map((g) => g.city));
});

test('회전은 순환한다 — 5주면 나머지 5개 도시가 전부 한 번씩 나온다', () => {
  const seen = new Set();
  for (let w = 0; w < 5; w++) for (const g of pickFeatured(CORPUS, { pinned: PINNED, rotate: 2, week: w }).slice(3)) seen.add(g.city);
  assert.deepEqual([...seen].sort(), ['Barcelona', 'Busan', 'Hong Kong', 'New York', 'Singapore']);
});

test('고정 도시에 아직 일정이 없으면 건너뛰고, 나머지가 없으면 고정만', () => {
  const out = pickFeatured([it('Tokyo', 3)], { pinned: PINNED, rotate: 2, week: 3 });
  assert.deepEqual(out.map((g) => g.city), ['Tokyo']);
});

test('weekKey는 같은 주 안에서 같고 월요일에 바뀐다', () => {
  assert.equal(weekKey(new Date('2026-08-19T00:00:00Z')), weekKey(new Date('2026-08-23T23:59:00Z'))); // Wed..Sun
  assert.equal(weekKey(new Date('2026-08-24T00:00:00Z')), weekKey(new Date('2026-08-23T00:00:00Z')) + 1); // Mon
});
