// cron-window 회귀 테스트 — 총괄 스케줄 감시견의 심장.
//
// 2026-08-27~28 이틀간 깃허브 스케줄러가 이 저장소의 크론을 무더기로
// 누락시켰다(레딧 카드 실종, 16:19 발행 2일 연속 미발화, 저녁 핀 누락).
// 감시견은 "이 크론이 마지막으로 울렸어야 할 시각"을 알아야 하고, 그
// 계산이 틀리면 멀쩡한 실행을 중복 발화시키거나 진짜 누락을 놓친다.
// 이 저장소의 크론은 전부 'M H * * *' / 'M H * * D' / 'M H * * D-D' /
// 'M H,H * * *' 꼴이라 그 부분집합만 정확히 지원한다(모르는 꼴은 throw —
// 조용히 틀리는 것보다 낫다).
//
//   node --test scripts/lib/cron-window.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastFireBefore } from './cron-window.mjs';

const T = (s) => Date.parse(s);

test('매일 크론: 오늘 시각이 지났으면 오늘, 아니면 어제', () => {
  assert.equal(lastFireBefore('30 11 * * *', T('2026-08-28T14:00:00Z')), T('2026-08-28T11:30:00Z'));
  assert.equal(lastFireBefore('30 11 * * *', T('2026-08-28T10:00:00Z')), T('2026-08-27T11:30:00Z'));
});

test('요일 크론: 일요일(0)만', () => {
  // 2026-08-28 = 금요일 → 직전 일요일은 08-23
  assert.equal(lastFireBefore('33 20 * * 0', T('2026-08-28T14:00:00Z')), T('2026-08-23T20:33:00Z'));
});

test('요일 범위 크론: 월-토(1-6)', () => {
  // 금요일 14:00Z, 크론 19:33 → 금요일분은 아직, 직전은 목요일 19:33
  assert.equal(lastFireBefore('33 19 * * 1-6', T('2026-08-28T14:00:00Z')), T('2026-08-27T19:33:00Z'));
  // 일요일(1-6 제외) 새벽이면 직전은 토요일
  assert.equal(lastFireBefore('33 19 * * 1-6', T('2026-08-30T02:00:00Z')), T('2026-08-29T19:33:00Z'));
});

test('시각 목록 크론: 두 슬롯 중 직전 것', () => {
  assert.equal(lastFireBefore('30 8,20 * * *', T('2026-08-28T14:00:00Z')), T('2026-08-28T08:30:00Z'));
  assert.equal(lastFireBefore('30 8,20 * * *', T('2026-08-28T22:00:00Z')), T('2026-08-28T20:30:00Z'));
});

test('경계: 정확히 그 시각이면 아직 안 울린 것으로 본다', () => {
  assert.equal(lastFireBefore('30 11 * * *', T('2026-08-28T11:30:00Z')), T('2026-08-27T11:30:00Z'));
});

test('지원하지 않는 꼴은 throw (조용히 틀리기 금지)', () => {
  assert.throws(() => lastFireBefore('*/5 * * * *', Date.parse('2026-08-28T00:00:00Z')));
  assert.throws(() => lastFireBefore('0 22 9-13 9 *', Date.parse('2026-08-28T00:00:00Z')));
});
