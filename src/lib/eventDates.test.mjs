import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtEventRange } from './eventDates.mjs';

test('one-day event prints one date; a run prints a range', () => {
  assert.equal(fmtEventRange('2026-08-09', '2026-08-09', 'en'), 'Aug 9');
  assert.equal(fmtEventRange('2026-08-09', null, 'en'), 'Aug 9');
  assert.equal(fmtEventRange('2026-08-09', '2026-09-05', 'en'), 'Aug 9 – Sep 5');
});

test('follows the locale and survives bad input', () => {
  assert.match(fmtEventRange('2026-08-09', '2026-09-05', 'ja'), /8月9日/);
  assert.equal(fmtEventRange(undefined, undefined, 'en'), '');
  assert.equal(fmtEventRange('not a date', null, 'en'), '');
});
