import test from 'node:test';
import assert from 'node:assert/strict';
import { crowdRows, summaryLines } from './crowd-chart.mjs';

const week = (text) => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => `${d}: ${text}`);

test('no busyness → no chart', () => {
  assert.equal(crowdRows(undefined, week('9:00 AM – 5:00 PM')), null);
  assert.equal(crowdRows({ weekdayQuiet: [], weekdayBusy: [], weekendQuiet: [], weekendBusy: [] }, week('9:00 AM – 5:00 PM')), null);
});

test('cells cover opening hours only, with three levels', () => {
  const r = crowdRows({ weekdayQuiet: [9, 10], weekdayBusy: [13], weekendQuiet: [], weekendBusy: [] }, week('9:00 AM – 5:00 PM'));
  assert.equal(r.weekday.length, 1);
  assert.deepEqual(r.weekday[0].days, ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
  const cells = r.weekday[0].cells;
  assert.deepEqual(cells.map((c) => c.h), [9, 10, 11, 12, 13, 14, 15, 16]);
  assert.deepEqual(cells.map((c) => c.level), ['quiet', 'quiet', 'mid', 'mid', 'busy', 'mid', 'mid', 'mid']);
  // weekend measured nothing → no row, not an all-normal bar
  assert.deepEqual(r.weekend, []);
});

test('busy wins over quiet', () => {
  const r = crowdRows({ weekdayQuiet: [], weekdayBusy: [], weekendQuiet: [10, 11], weekendBusy: [11] }, week('9:00 AM – 5:00 PM'));
  const lv = Object.fromEntries(r.weekend[0].cells.map((c) => [c.h, c.level]));
  assert.equal(lv[10], 'quiet');
  assert.equal(lv[11], 'busy');
});

test('hours outside a day\'s opening hours are dropped; a lunch break is a closed gap', () => {
  const r = crowdRows({ weekdayQuiet: [8, 11], weekdayBusy: [18], weekendQuiet: [], weekendBusy: [] }, week('11:00 AM – 2:00 PM, 5:00 – 9:00 PM'));
  const cells = r.weekday[0].cells;
  assert.equal(cells[0].h, 11);
  assert.equal(cells.at(-1).h, 20);
  assert.ok(!cells.some((c) => c.h === 8));
  assert.equal(cells.find((c) => c.h === 15).level, 'closed');
  assert.equal(cells.find((c) => c.h === 18).level, 'busy');
});

test('late-night hours run after the evening, not before the morning', () => {
  const r = crowdRows({ weekdayQuiet: [], weekdayBusy: [22, 0], weekendQuiet: [], weekendBusy: [] }, week('6:00 PM – 2:00 AM'));
  assert.deepEqual(r.weekday[0].cells.map((c) => c.h), [18, 19, 20, 21, 22, 23, 0, 1]);
});

test('days with different hours get separate rows', () => {
  const lines = week('9:00 AM – 5:00 PM');
  lines[4] = 'Friday: 9:00 AM – 9:00 PM';
  const r = crowdRows({ weekdayQuiet: [9], weekdayBusy: [], weekendQuiet: [], weekendBusy: [] }, lines);
  assert.equal(r.weekday.length, 2);
  // … but one sentence, because the quiet hours are the same
  const s = summaryLines(r.weekday, 'quiet');
  assert.equal(s.length, 1);
  assert.equal(s[0].days.length, 5);
});

test('closed days get no row', () => {
  const lines = week('9:00 AM – 5:00 PM');
  lines[0] = 'Monday: Closed';
  const r = crowdRows({ weekdayQuiet: [9], weekdayBusy: [], weekendQuiet: [], weekendBusy: [] }, lines);
  assert.deepEqual(r.weekday[0].days, ['Tuesday', 'Wednesday', 'Thursday', 'Friday']);
});

test('unknown opening hours fall back to the 7am–10pm window', () => {
  const r = crowdRows({ weekdayQuiet: [8], weekdayBusy: [12], weekendQuiet: [], weekendBusy: [] }, undefined);
  assert.equal(r.weekday[0].cells.length, 16);
  assert.equal(r.weekday[0].cells[0].h, 7);
});
