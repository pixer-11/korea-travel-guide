// round-robin 회귀 테스트 — 레딧 스카우트의 "차례대로"를 고정한다.
//
// 2026-08-27 코덱스 감사: 한 그룹씩 뽑는 것까진 맞았지만 시작점이 항상
// SUBS[0] 이라, 카드 3장이 성공하는 날엔 항상 같은 앞 3개 서브레딧만 카드를
// 받았다("차례대로"의 절반 구현). 시작점이 날마다 돌아야 뒷줄에도 차례가 온다.
//
//   node --test scripts/lib/round-robin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interleaveRotated, kstDayIndex } from './round-robin.mjs';

const groups = () => new Map([
  ['japan', ['j1', 'j2']],
  ['korea', ['k1']],
  ['thailand', ['t1', 't2', 't3']],
]);

test('한 그룹에서 하나씩, 바퀴 단위로 뽑는다', () => {
  assert.deepEqual(interleaveRotated(groups(), 0), ['j1', 'k1', 't1', 'j2', 't2', 't3']);
});

test('시작점이 돌면 첫 자리가 바뀐다 — 앞줄 독점 방지', () => {
  assert.deepEqual(interleaveRotated(groups(), 1), ['k1', 't1', 'j1', 't2', 'j2', 't3']);
  assert.deepEqual(interleaveRotated(groups(), 2), ['t1', 'j1', 'k1', 't2', 'j2', 't3']);
  assert.deepEqual(interleaveRotated(groups(), 3), interleaveRotated(groups(), 0), '한 바퀴 = 제자리');
});

test('빈 입력과 그룹 하나도 안전하다', () => {
  assert.deepEqual(interleaveRotated(new Map(), 5), []);
  assert.deepEqual(interleaveRotated(new Map([['solo', ['a', 'b']]]), 3), ['a', 'b']);
});

test('kstDayIndex 는 KST 자정에 바뀐다', () => {
  const beforeMidnight = Date.parse('2026-08-27T23:59:00+09:00');
  const afterMidnight = Date.parse('2026-08-28T00:01:00+09:00');
  assert.equal(kstDayIndex(afterMidnight) - kstDayIndex(beforeMidnight), 1);
});
