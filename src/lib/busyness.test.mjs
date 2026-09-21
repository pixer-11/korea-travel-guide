import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBusyness, hasBusynessConflict, perDayBusyness, quietDayGroups, busyDayGroups, dayGroupKind, dayGroupText } from './busyness.mjs';

// The real record that exposed this: Lyon's Café Joyeux, weekend quiet 9-16 and
// weekend busy 11-18, overlapping at 11-16.
const LYON = {
  weekdayQuiet: [9],
  weekdayBusy: [15],
  weekendQuiet: [9, 10, 11, 12, 13, 14, 15, 16],
  weekendBusy: [11, 12, 13, 14, 15, 16, 17, 18],
};

test('a contested hour is busy, not quiet', () => {
  const r = resolveBusyness(LYON);
  assert.deepEqual(r.weekendQuiet, [9, 10], 'only the uncontested hours stay quiet');
  assert.deepEqual(r.weekendBusy, [11, 12, 13, 14, 15, 16, 17, 18], 'busy is untouched');
  for (const h of r.weekendQuiet) assert.ok(!r.weekendBusy.includes(h), `hour ${h} in both lists`);
});

test('weekday is resolved by the same rule', () => {
  const r = resolveBusyness({ weekdayQuiet: [9, 15], weekdayBusy: [15] });
  assert.deepEqual(r.weekdayQuiet, [9]);
});

// The reverse direction: a filter that "fixes" contradictions by dropping
// everything would also pass the test above. These make sure clean data — the
// other 94% — survives untouched.
test('clean data is not altered', () => {
  const clean = {
    weekdayQuiet: [8, 9, 16],
    weekdayBusy: [],
    weekendQuiet: [8],
    weekendBusy: [10, 11, 12, 13, 14, 15],
  };
  const r = resolveBusyness(clean);
  assert.deepEqual(r.weekdayQuiet, [8, 9, 16]);
  assert.deepEqual(r.weekendQuiet, [8]);
  assert.deepEqual(r.weekendBusy, [10, 11, 12, 13, 14, 15]);
});

test('quiet hours survive when there is no busy list at all', () => {
  const r = resolveBusyness({ weekendQuiet: [7, 8] });
  assert.deepEqual(r.weekendQuiet, [7, 8], 'nothing to subtract, nothing removed');
  assert.deepEqual(r.weekendBusy, []);
});

test('output is always arrays and always sorted', () => {
  const r = resolveBusyness({ weekendQuiet: [16, 8, 12], weekendBusy: [12] });
  assert.deepEqual(r.weekendQuiet, [8, 16]);
  const empty = resolveBusyness(null);
  for (const k of ['weekdayQuiet', 'weekdayBusy', 'weekendQuiet', 'weekendBusy']) {
    assert.deepEqual(empty[k], [], `${k} should be [] for a null block`);
  }
  assert.deepEqual(resolveBusyness(undefined).weekendQuiet, []);
});

test('conflict detector fires on real conflicts only', () => {
  assert.equal(hasBusynessConflict(LYON), true);
  assert.equal(hasBusynessConflict({ weekendQuiet: [8], weekendBusy: [10, 11] }), false);
  assert.equal(hasBusynessConflict({ weekendQuiet: [], weekendBusy: [] }), false);
  assert.equal(hasBusynessConflict(null), false);
  assert.equal(hasBusynessConflict({ weekdayQuiet: [15], weekdayBusy: [15] }), true);
});

// ── 날 묶음 (2026-09-21) ──────────────────────────────────────
// "주말"은 BestTime에겐 한 덩어리지만 가게에겐 서로 다른 두 날이다. 묶음을
// 교차해 버리면 참인 사실까지 사라지므로, 날별로 재고 뜻이 같은 날끼리 묶는다.
const WEEK = (mon, sat = mon, sun = mon) => [
  `Monday: ${mon}`, `Tuesday: ${mon}`, `Wednesday: ${mon}`, `Thursday: ${mon}`,
  `Friday: ${mon}`, `Saturday: ${sat}`, `Sunday: ${sun}`,
];
const MET = [
  'Monday: 10:00 AM – 5:00 PM', 'Tuesday: 10:00 AM – 5:00 PM', 'Wednesday: Closed',
  'Thursday: 10:00 AM – 5:00 PM', 'Friday: 10:00 AM – 9:00 PM',
  'Saturday: 10:00 AM – 9:00 PM', 'Sunday: 10:00 AM – 5:00 PM',
];

test('🛑 묶음 안의 하루라도 닫혀 있으면 그 시간은 빠진다 — Subhash Bose Park', () => {
  const hours = WEEK('6:00 – 9:00 AM, 2:00 – 8:30 PM', undefined, '6:00 – 9:00 AM, 11:00 AM – 8:30 PM');
  const perDay = perDayBusyness({ weekendQuiet: [11, 12, 13] }, hours);
  assert.deepEqual(perDay.get('Saturday').quiet, [], '토요일은 9-14시 닫혀 있다');
  assert.deepEqual(perDay.get('Sunday').quiet, [11, 12, 13], '일요일은 11시에 연다');
});

test('✅ 교차로 버리지 않는다 — 금·토 야간개장의 5시는 진짜 한산하다 (메트로폴리탄)', () => {
  const g = quietDayGroups({ weekdayQuiet: [17], weekendQuiet: [17] }, MET);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].days, ['Friday', 'Saturday']);
  assert.deepEqual(g[0].quiet, [17]);
  assert.deepEqual(dayGroupKind(g[0].days), { kind: 'list', days: ['Friday', 'Saturday'] });
});

test('🛑 기준이 아닌 필드는 묶음의 모든 날이 공유하는 것만 남는다', () => {
  // 금요일은 12-16시, 토요일은 12-18시 붐빈다. quiet 기준으로 묶었다고 해서
  // 금요일 행에 토요일의 혼잡을 실으면 안 된다.
  const g = quietDayGroups({ weekdayQuiet: [17], weekendQuiet: [17], weekdayBusy: [12, 13], weekendBusy: [12, 13, 14] }, MET);
  assert.deepEqual(g[0].days, ['Friday', 'Saturday']);
  assert.deepEqual(g[0].busy, [12, 13], '두 날이 함께 붐비는 시간만');
});

test('✅ 한산 묶음과 혼잡 묶음은 따로 센다 — 한 줄이 다른 줄 때문에 쪼개지면 안 된다', () => {
  const b = { weekdayQuiet: [17], weekendQuiet: [17], weekdayBusy: [12], weekendBusy: [12, 13] };
  assert.equal(quietDayGroups(b, MET).length, 1, '한산은 금·토 한 묶음');
  assert.ok(busyDayGroups(b, MET).length >= 2, '혼잡은 날마다 다르므로 더 쪼개진다');
});

test('✅ 읽을 주간표가 없으면 판정하지 않는다 — 호출자가 기존 평일/주말을 쓴다', () => {
  assert.equal(perDayBusyness({ weekdayQuiet: [9] }, undefined), null);
  assert.equal(quietDayGroups({ weekdayQuiet: [9] }, []), null);
  assert.equal(busyDayGroups(null, WEEK('9:00 AM – 5:00 PM')), null);
});

test('묶음 이름 — 실측 분포대로', () => {
  const D = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const en = (k) => ({
    'post.daily': 'Daily', 'post.weekdays': 'Weekdays', 'post.weekends': 'Weekends',
    'post.everyDayBut': 'Every day but {day}',
    'day.mon': 'Mon', 'day.tue': 'Tue', 'day.wed': 'Wed', 'day.thu': 'Thu',
    'day.fri': 'Fri', 'day.sat': 'Sat', 'day.sun': 'Sun',
  }[k]);
  assert.equal(dayGroupText(D, en), 'Daily');
  assert.equal(dayGroupText(D.slice(0, 5), en), 'Weekdays');
  assert.equal(dayGroupText(D.slice(5), en), 'Weekends');
  assert.equal(dayGroupText(['Friday', 'Saturday'], en), 'Fri·Sat');
  assert.equal(dayGroupText(D.filter((d) => d !== 'Wednesday'), en), 'Every day but Wed');
  // 순서는 늘 월→일, 넘겨준 순서와 무관하게.
  assert.equal(dayGroupText(['Sunday', 'Monday'], en), 'Mon·Sun');
});

test('🛑 quiet 과 busy 가 겹치면 busy 가 이긴다 — 날 묶음에서도', () => {
  const perDay = perDayBusyness({ weekdayQuiet: [11, 12], weekdayBusy: [12] }, WEEK('9:00 AM – 8:00 PM'));
  assert.deepEqual(perDay.get('Monday').quiet, [11], '12시는 붐비므로 한산에서 빠진다');
  assert.deepEqual(perDay.get('Monday').busy, [12]);
});
