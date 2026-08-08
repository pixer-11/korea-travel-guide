import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openHourSet, clampBusynessHours } from './hours.mjs';

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
