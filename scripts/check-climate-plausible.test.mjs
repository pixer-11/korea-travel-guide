// 양방향: 2026-09-09에 실제로 틀려 있던 두 나라를 잡는가, 그리고 멀쩡한 나라를
// 잡지는 않는가. 실측값을 그대로 픽스처로 쓴다 — 지어낸 숫자로는 이 검사가
// 진짜 사건을 잡는지 알 수 없다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { climateIssues, seasonalSwingBounds } from './check-climate-plausible.mjs';

const mk = (his, los, rain = 100) => his.map((hi, i) => ({ m: i + 1, hi, lo: los[i], rain }));

// 옛 Open-Meteo 값 (하노이 자리에 바다를 집은 것으로 보인다): 1월 32도 / 7월 31도
const HANOI_BAD = mk([32, 33, 35, 34, 33, 31, 31, 31, 31, 30, 31, 31],
                     [23, 23, 25, 26, 26, 25, 25, 25, 25, 24, 24, 23]);
// 새 NASA POWER 값 — 북위 21도 도시답게 겨울이 있다
const HANOI_GOOD = mk([21, 23, 28, 30, 32, 33, 32, 32, 31, 28, 25, 21],
                      [12, 13, 17, 21, 24, 26, 26, 25, 24, 20, 17, 12]);
// 옛 발리 값 (산악 격자로 보인다): 적도 섬이 연중 21~24도
const BALI_BAD = mk([22, 22, 22, 22, 22, 22, 21, 22, 23, 24, 23, 22],
                    [17, 17, 16, 16, 16, 15, 15, 14, 15, 16, 16, 17]);
const BALI_GOOD = mk([28, 28, 28, 29, 28, 27, 27, 27, 29, 30, 30, 29],
                     [24, 24, 24, 24, 24, 23, 22, 22, 23, 24, 24, 24]);
// 서울: 계절이 크고 그게 정상이다
const SEOUL = mk([2, 4, 11, 17, 22, 26, 29, 29, 25, 19, 12, 3],
                 [-6, -4, 0, 6, 11, 17, 22, 23, 18, 10, 3, -4]);

test('하노이 옛 값을 잡는다 — 북위 21도에 계절이 없다', () => {
  const hits = climateIssues('Vietnam', HANOI_BAD, 21);
  assert.ok(hits.some((h) => /계절이 없다/.test(h)), JSON.stringify(hits));
});

test('하노이 새 값은 잡지 않는다 (역방향)', () => {
  assert.deepEqual(climateIssues('Vietnam', HANOI_GOOD, 21), []);
});

test('발리 옛 값을 잡는다 — 적도대인데 서늘하다', () => {
  const hits = climateIssues('Indonesia', BALI_BAD, 8.4);
  assert.ok(hits.some((h) => /고지대 격자/.test(h)), JSON.stringify(hits));
});

test('발리 새 값은 잡지 않는다 (역방향)', () => {
  assert.deepEqual(climateIssues('Indonesia', BALI_GOOD, 8.4), []);
});

test('계절이 큰 온대 도시를 오탐하지 않는다', () => {
  assert.deepEqual(climateIssues('South Korea', SEOUL, 37.5), []);
});

test('최고가 최저보다 낮으면 잡는다', () => {
  const broken = mk([5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], [9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]);
  assert.ok(climateIssues('Nowhere', broken, 45).some((h) => /최고.*최저/.test(h)));
});

test('12개월이 아니면 그것부터 말한다', () => {
  const hits = climateIssues('Short', mk([20, 21], [10, 11]), 30);
  assert.equal(hits.length, 1);
  assert.match(hits[0], /12개월치가 아니다/);
});

test('위도를 모르면 범위 검사만 하고 계절은 따지지 않는다', () => {
  assert.deepEqual(climateIssues('Unknown', HANOI_BAD, null), []);
});

test('적도대의 기대 연교차는 좁고, 고위도는 넓다', () => {
  assert.ok(seasonalSwingBounds(5).max < seasonalSwingBounds(45).max);
  assert.equal(seasonalSwingBounds(5).min, 0);
  assert.ok(seasonalSwingBounds(45).min >= 8);
});
