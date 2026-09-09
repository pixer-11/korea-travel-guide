// 양방향: 안 돈 날을 잡는가 + 구조로 돌아간 날·오늘·지나간 창 밖의 날을
// 잘못 잡지는 않는가. (2026-09-09, 판정 기준을 지연에서 누락으로 바꾸며 추가)
import test from 'node:test';
import assert from 'node:assert/strict';
import { missedDays, MISSED_DAY_LIMIT } from './cron-missed-days.mjs';

const KST = 9 * 3600e3;
// 2026-09-09 12:00 KST 를 '지금'으로 고정한다.
const NOW = Date.parse('2026-09-09T03:00:00Z');
const slotOn = (kstDate) => Date.parse(`${kstDate}T07:19:00Z`) + 0; // 16:19 KST
const dayOf = (t) => new Date(t + KST).toISOString().slice(0, 10);

// 09-03 ~ 09-09 매일 한 슬롯
const week = ['09-03', '09-04', '09-05', '09-06', '09-07', '09-08', '09-09'].map((d) => slotOn(`2026-${d}`));

test('예약된 날인데 아무 실행도 없으면 잡는다', () => {
  const ran = new Set(week.map(dayOf).filter((d) => d !== '2026-09-05'));
  const r = missedDays([{ file: 'publish.yml', slotTimes: week, ranDays: ran }], { now: NOW });
  assert.equal(r.total, 1);
  assert.deepEqual(r.perWorkflow[0].days, ['2026-09-05']);
});

test('구조 발화로 돌아간 날은 안 된 날이 아니다 (ranDays 는 모든 트리거)', () => {
  const r = missedDays([{ file: 'publish.yml', slotTimes: week, ranDays: new Set(week.map(dayOf)) }], { now: NOW });
  assert.equal(r.total, 0);
});

test('오늘은 아직 진행 중이라 세지 않는다', () => {
  // 오늘(09-09) 슬롯은 12:00 KST 기준으로 아직 안 왔다.
  const ran = new Set(week.map(dayOf).filter((d) => d !== '2026-09-09'));
  const r = missedDays([{ file: 'publish.yml', slotTimes: week, ranDays: ran }], { now: NOW });
  assert.equal(r.total, 0, JSON.stringify(r.perWorkflow));
});

test('창 밖(7일 전보다 이전)의 사고는 다시 울리지 않는다', () => {
  const old = [slotOn('2026-08-27'), slotOn('2026-08-28'), ...week];
  const ran = new Set(week.map(dayOf));   // 8월 이틀은 안 돌았다
  const r = missedDays([{ file: 'publish.yml', slotTimes: old, ranDays: ran }], { now: NOW });
  assert.equal(r.total, 0);
  // 창을 넓히면 같은 데이터가 잡힌다 — 창이 판정을 만든다는 증거
  assert.equal(missedDays([{ file: 'publish.yml', slotTimes: old, ranDays: ran }], { now: NOW, recentDays: 20 }).total, 2);
});

test('건너뛴 워크플로와 슬롯 없는 워크플로는 판정 대상이 아니다', () => {
  const r = missedDays([
    { file: 'monthly.yml', skip: '주간/월간 제외' },
    { file: 'nocron.yml', slotTimes: [] },
  ], { now: NOW });
  assert.equal(r.total, 0);
});

test('경보 문턱은 사흘 — 이틀은 조용하고 사흘은 운다', () => {
  const ran = new Set(week.map(dayOf).filter((d) => !['2026-09-05', '2026-09-06'].includes(d)));
  assert.ok(missedDays([{ file: 'a.yml', slotTimes: week, ranDays: ran }], { now: NOW }).total < MISSED_DAY_LIMIT);
  const ran3 = new Set(week.map(dayOf).filter((d) => !['2026-09-04', '2026-09-05', '2026-09-06'].includes(d)));
  assert.ok(missedDays([{ file: 'a.yml', slotTimes: week, ranDays: ran3 }], { now: NOW }).total >= MISSED_DAY_LIMIT);
});
