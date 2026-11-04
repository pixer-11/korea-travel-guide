import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openHourSet, clampBusynessHours, formatHour, formatHourRanges, localizeOpeningLine } from './hours.mjs';

// ── partial first hour (nice-parc-ph-nix, held at the gate 2026-08-08) ──────
// The park opens 9:30 AM; BestTime marked hour 9 quiet; the unclamped fact
// became "come at 9–10am" in print. A partially-open hour must not survive
// the clamp on EITHER side of the day.

const HALF_OPEN = [
  'Monday: 9:30 AM – 7:30 PM', 'Tuesday: 9:30 AM – 7:30 PM',
  'Wednesday: 9:30 AM – 7:30 PM', 'Thursday: 9:30 AM – 7:30 PM',
  'Friday: 9:30 AM – 7:30 PM', 'Saturday: 9:30 AM – 7:30 PM', 'Sunday: 9:30 AM – 7:30 PM',
];

test('9:30 opening drops hour 9 from the open set', () => {
  const set = openHourSet(HALF_OPEN);
  assert.equal(set.has(9), false);
  assert.equal(set.has(10), true);
  // closing side was already conservative: 7:00–7:30 PM sliver excluded
  assert.equal(set.has(19), false);
  assert.equal(set.has(18), true);
});

test('quiet hour 9 is clamped away at a 9:30-opening venue', () => {
  const res = clampBusynessHours(
    { weekendQuiet: [9], weekendBusy: [12, 13], weekdayQuiet: [9, 10, 18], weekdayBusy: [] },
    HALF_OPEN,
  );
  assert.deepEqual(res.weekendQuiet, []);
  assert.deepEqual(res.weekdayQuiet, [10, 18]);
  assert.deepEqual(res.weekendBusy, [12, 13]);
  assert.equal(res.changed, true);
});

test('on-the-hour opening keeps its first hour (no over-clamping)', () => {
  const WHOLE = ['Monday: 9:00 AM – 7:00 PM', 'Saturday: 9:00 AM – 7:00 PM', 'Sunday: 9:00 AM – 7:00 PM'];
  const set = openHourSet(WHOLE);
  assert.equal(set.has(9), true);
  const res = clampBusynessHours({ weekdayQuiet: [9], weekendQuiet: [9], weekdayBusy: [], weekendBusy: [] }, WHOLE);
  assert.deepEqual(res.weekdayQuiet, [9]);
  assert.deepEqual(res.weekendQuiet, [9]);
});

test('11:30 PM opening across midnight adds only full hours', () => {
  const set = openHourSet(['Friday: 11:30 PM – 2:00 AM']);
  assert.equal(set.has(23), false);
  assert.equal(set.has(0), true);
  assert.equal(set.has(1), true);
  assert.equal(set.has(2), false);
});

test('12:30 PM opening drops the noon hour', () => {
  const set = openHourSet(['Monday: 12:30 PM – 6:00 PM']);
  assert.equal(set.has(12), false);
  assert.equal(set.has(13), true);
});

// ── the clock in the reader's language (2026-11-04) ─────────────────────────
// The crowd box printed 「下午 9点」 and 「午前 9時」: a space neither language
// writes, and 下午 for an hour Chinese calls 晚上. The words now follow what the
// translator itself writes most, and the same rule fills the prose
// (scripts/lib/localize-clock.mjs).

test('zh/ja hours: no space, and Chinese names the part of the day', () => {
  assert.deepEqual([7, 9, 12, 18, 19, 21, 0, 2].map((h) => formatHour(h, { lang: 'zh' })),
    ['早上7点', '上午9点', '中午12点', '下午6点', '晚上7点', '晚上9点', '午夜12点', '凌晨2点']);
  assert.deepEqual([0, 7, 12, 21].map((h) => formatHour(h, { lang: 'ja' })), ['午前0時', '午前7時', '正午', '午後9時']);
});

test('ja noon is 正午 at either end; a run ending at 23:00 never folds into "午前6~0時"', () => {
  assert.equal(formatHourRanges([9, 10, 11], { lang: 'ja' }), '午前9時~正午');
  assert.equal(formatHourRanges([12, 13, 14], { lang: 'ja' }), '正午~午後3時');
  assert.equal(formatHourRanges([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23], { lang: 'ja' }), '午前6時~午前0時');
  assert.equal(formatHourRanges([20, 21, 22, 23], { am: '오전', pm: '오후', lang: 'ko' }), '오후 8시~오전 12시');
  assert.equal(formatHourRanges([20, 21, 22, 23], { lang: 'en' }), '8 PM–12 AM');
});

test('ko, en and es hours are unchanged', () => {
  assert.deepEqual([0, 7, 12, 21].map((h) => formatHour(h, { am: '오전', pm: '오후', lang: 'ko' })), ['오전 12시', '오전 7시', '오후 12시', '오후 9시']);
  assert.deepEqual([7, 21].map((h) => formatHour(h, { lang: 'en' })), ['7am', '9pm']);
  assert.equal(formatHourRanges([8, 9, 10], { am: '오전', pm: '오후', lang: 'ko' }), '오전 8~11시');
  assert.equal(formatHourRanges([11, 12, 13], { lang: 'en' }), '11 AM–2 PM');
});

test('zh/ja ranges say the word once inside one part of the day', () => {
  assert.equal(formatHourRanges([8, 9, 10], { lang: 'zh' }), '早上8~11点');
  assert.equal(formatHourRanges([17, 18, 19], { lang: 'zh' }), '下午5点~晚上8点');
  assert.equal(formatHourRanges([22, 23], { lang: 'zh' }), '晚上10点~午夜12点');
  assert.equal(formatHourRanges([8, 9, 10], { lang: 'ja' }), '午前8~11時');
  assert.equal(formatHourRanges([11, 12, 13], { lang: 'ja' }), '午前11時~午後2時');
});

test('opening lines: zh/ja take the same word with no space; Google\'s number stays', () => {
  assert.equal(localizeOpeningLine('Monday: 8:00 AM – 12:00 AM', 'zh'), '周一: 早上8:00 – 午夜12:00');
  assert.equal(localizeOpeningLine('Friday: 11:30 AM – 9:30 PM', 'zh'), '周五: 上午11:30 – 晚上9:30');
  // Japanese midnight is 午前0:00 — 午前12:00 reads as noon (native review, 11-04).
  assert.equal(localizeOpeningLine('Monday: 8:00 AM – 12:00 AM', 'ja'), '月曜日: 午前8:00 – 午前0:00');
  assert.equal(localizeOpeningLine('Friday: 6:00 PM – 12:30 AM', 'zh'), '周五: 下午6:00 – 凌晨0:30');
  assert.equal(localizeOpeningLine('Monday: 8:00 AM – 12:00 AM', 'ko', { am: '오전', pm: '오후' }), '월요일: 오전 8:00 – 오전 12:00');
});

test('ja opening lines: noon is 正午, 12:30 PM is 午後0:30 (Codex, 11-04)', () => {
  assert.equal(localizeOpeningLine('Monday: 12:00 PM – 1:00 PM', 'ja'), '月曜日: 正午 – 午後1:00');
  assert.equal(localizeOpeningLine('Monday: 12:30 PM – 9:00 PM', 'ja'), '月曜日: 午後0:30 – 午後9:00');
});
