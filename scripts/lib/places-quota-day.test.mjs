// 구글 일일 한도는 태평양 시각 자정에 초기화된다(UTC 자정 아님).
//   node --test scripts/lib/places-quota-day.test.mjs
// 2026-10-12 10:33 KST 에 장부는 19/100 이었는데 구글은 이미 429 를 돌려줬다 —
// 장부가 UTC 날짜로 하루를 셌기 때문에, 09:00~16:00 KST 의 실행은 전날 오후
// 발행·대량 실행이 다 쓴 한도를 새것으로 믿었다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quotaDay } from './places-budget.mjs';

test('summer (PDT): the quota day turns at 16:00 KST', () => {
  assert.equal(quotaDay(new Date('2026-10-12T01:33:00Z')), '2026-10-11'); // 10:33 KST — yesterday's quota
  assert.equal(quotaDay(new Date('2026-10-12T06:59:00Z')), '2026-10-11');
  assert.equal(quotaDay(new Date('2026-10-12T07:19:00Z')), '2026-10-12'); // the 16:19 KST publish opens a fresh day
});

test('winter (PST): the quota day turns at 17:00 KST', () => {
  assert.equal(quotaDay(new Date('2026-12-12T07:19:00Z')), '2026-12-11');
  assert.equal(quotaDay(new Date('2026-12-12T08:00:00Z')), '2026-12-12');
});
