import test from 'node:test';
import assert from 'node:assert/strict';
import { crowdClaimSupported, claimedHours } from './crowd-claim.mjs';

// The Lady Bird Johnson Wildflower Center, flagged as invented-specifics on
// 2026-09-19 while its own frontmatter measured exactly that window.
const LADYBIRD = { weekdayQuiet: [9, 15], weekendBusy: [10, 11, 12, 13, 14] };

test('범위의 끝시각은 "그 시간까지"다 — 10am to 3pm 은 10~14시', () => {
  assert.deepEqual(claimedHours('peaks between 10am and 3pm'), [10, 11, 12, 13, 14]);
  assert.deepEqual(claimedHours('arrive right at 10am'), [10]);
});

test('측정과 일치하는 혼잡 문장은 지적이 아니다 (오탐 차단)', () => {
  assert.equal(crowdClaimSupported('Weekend foot traffic peaks between 10am and 3pm', LADYBIRD), true);
});

test('측정과 어긋나는 문장은 그대로 지적으로 남는다', () => {
  // 주말 10-14시는 측정상 붐비는데 한산하다고 말한다
  assert.equal(crowdClaimSupported('Weekends are quietest between 10am and 3pm', LADYBIRD), false);
  // 측정에 없는 시간대
  assert.equal(crowdClaimSupported('Weekend crowds peak between 6am and 8am', LADYBIRD), false);
});

test('잴 수 없는 것은 봐주지 않는다', () => {
  assert.equal(crowdClaimSupported('It is quietest at 8am', null), false);           // 데이터 없음
  assert.equal(crowdClaimSupported('The queue moves fast', LADYBIRD), false);        // 시각 없음
  assert.equal(crowdClaimSupported('Open from 9am to 4pm daily', LADYBIRD), false);  // 방향 단어 없음
});

test('요일을 지목하면 그쪽 측정만 본다', () => {
  const bz = { weekdayQuiet: [9, 10], weekendBusy: [9, 10] };
  assert.equal(crowdClaimSupported('On weekdays it is calmest from 9am to 11am', bz), true);
  assert.equal(crowdClaimSupported('On weekends it is calmest from 9am to 11am', bz), false);
});
