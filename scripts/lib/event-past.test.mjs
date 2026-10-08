import test from 'node:test';
import assert from 'node:assert/strict';
import { isPastEvent } from './event-past.mjs';

const T = '2026-10-08';
test('the four 10-08 strays are past', () => {
  for (const d of ['2026-05-20', '2026-07-08', '2026-09-14', '2026-10-01'])
    assert.equal(isPastEvent({ startDate: d, endDate: d }, T), true, d);
});
test('today, yesterday and future events are kept', () => {
  for (const d of ['2026-10-07', '2026-10-08', '2026-11-08'])
    assert.equal(isPastEvent({ startDate: d, endDate: d }, T), false, d);
});
test('a multi-day event still running is kept (end date decides)', () => {
  assert.equal(isPastEvent({ startDate: '2026-09-20', endDate: '2026-10-12' }, T), false);
});
test('no usable date is not judged past', () => {
  assert.equal(isPastEvent({}, T), false);
  assert.equal(isPastEvent({ startDate: 'October 2026' }, T), false);
});
