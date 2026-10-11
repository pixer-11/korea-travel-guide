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

// 2026-10-11: 자정을 넘긴 지각을 누락으로 셌다 (runTimes 로 슬롯별 판정)
test('자정을 넘겨 돈 지각 실행은 누락이 아니다', () => {
  const now = Date.parse('2026-10-11T00:00:00Z');
  const slots = ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']
    .map((d) => Date.parse(`${d}T08:30:00Z`)); // 17:30 KST
  // 10-05 슬롯은 10-05 17:14 UTC(= 10-06 02:14 KST)에 돌았다
  const runs = slots.map((s, i) => s + (i === 1 ? 8.7 * 3600e3 : 6 * 3600e3));
  const r = missedDays([{ file: 'smoke.yml', slotTimes: slots, runTimes: runs }], { now });
  assert.equal(r.total, 0, JSON.stringify(r.perWorkflow));
});

test('그날 첫 슬롯부터 24시간 안에 실행이 없으면 그날로 잡는다', () => {
  const now = Date.parse('2026-10-11T00:00:00Z');
  const slots = ['2026-10-07', '2026-10-08', '2026-10-09'].map((d) => Date.parse(`${d}T07:11:00Z`));
  const runs = [slots[0] + 3600e3, slots[2] + 3600e3]; // 10-08 슬롯만 아무것도 없다
  const r = missedDays([{ file: 'a.yml', slotTimes: slots, runTimes: runs }], { now });
  assert.deepEqual(r.perWorkflow[0].days, ['2026-10-08']);
});

test('창(24시간)이 지나기 전에는 판정을 미룬다', () => {
  const slot = Date.parse('2026-10-10T08:30:00Z');
  const before = missedDays([{ file: 'a.yml', slotTimes: [slot], runTimes: [] }], { now: slot + 10 * 3600e3 });
  assert.equal(before.total, 0);
  const after = missedDays([{ file: 'a.yml', slotTimes: [slot], runTimes: [] }], { now: slot + 25 * 3600e3 });
  assert.equal(after.total, 1);
});

test('하루 두 번 슬롯이 다음 슬롯을 넘겨 늦어도 그날은 된 것이다', () => {
  const now = Date.parse('2026-10-11T00:00:00Z');
  const slots = [];
  for (const d of ['2026-10-08', '2026-10-09']) slots.push(Date.parse(`${d}T08:45:00Z`), Date.parse(`${d}T13:20:00Z`));
  const runs = slots.map((s) => s + 6 * 3600e3); // 매번 6시간 지각 — 둘째 실행은 다음 날 KST
  const r = missedDays([{ file: 'live-checks.yml', slotTimes: slots, runTimes: runs }], { now });
  assert.equal(r.total, 0, JSON.stringify(r.perWorkflow));
});
