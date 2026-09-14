// node --test scripts/lib/quiet-window.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { hourRuns24, quietWindowSummary } from './quiet-window.mjs';

test('떨어진 한산 시간은 구간을 나눠 말한다 — 한낮을 한산하다고 하지 않는다', () => {
  // sun-moon-lake Wenwu Temple, the card that read "quiet 7am–11pm".
  assert.equal(hourRuns24([7, 19, 20, 21, 22]), '7:00-8:00 and 19:00-23:00');
});

test('이어진 시간은 한 구간이다', () => {
  assert.equal(hourRuns24([9, 10, 11]), '9:00-12:00');
  assert.equal(hourRuns24([11, 9, 10, 10]), '9:00-12:00', '순서·중복과 무관');
});

test('주말 자료만 있으면 "weekdays null" 이 아니라 주말만 말한다', () => {
  assert.equal(quietWindowSummary({ weekendQuiet: [9, 10] }), 'weekends 9:00-11:00');
});

test('둘 다 있으면 둘 다, 없으면 null', () => {
  assert.equal(
    quietWindowSummary({ weekdayQuiet: [7, 19], weekendQuiet: [8] }),
    'weekdays 7:00-8:00 and 19:00-20:00, weekends 8:00-9:00',
  );
  assert.equal(quietWindowSummary({ weekdayQuiet: [], weekendQuiet: [] }), null);
  assert.equal(quietWindowSummary(null), null);
});

test('시간이 아닌 값은 버린다', () => {
  assert.equal(hourRuns24([7, 'x', 8.5, 24, -1, 8]), '7:00-9:00');
});
