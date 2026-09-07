import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIndexableMonthPage, monthPageSignals } from './thin-page-policy.mjs';

// The decision (task-6-brief.md, 2026-08-31): noindex only the intersection —
// neither a holiday nor an event that month. Any single signal is enough to
// keep the page indexable.
test('isIndexableMonthPage: neither signal -> not indexable', () => {
  assert.equal(isIndexableMonthPage({ hasEvents: false, hasHolidays: false }), false);
});

test('isIndexableMonthPage: events only -> indexable', () => {
  assert.equal(isIndexableMonthPage({ hasEvents: true, hasHolidays: false }), true);
});

test('isIndexableMonthPage: holidays only -> indexable', () => {
  assert.equal(isIndexableMonthPage({ hasEvents: false, hasHolidays: true }), true);
});

test('isIndexableMonthPage: both -> indexable', () => {
  assert.equal(isIndexableMonthPage({ hasEvents: true, hasHolidays: true }), true);
});

// monthPageSignals must read the exact same fields WhenToGoPage.astro renders
// its own "no events"/"no holidays" fallback copy from, or the page's visible
// content and its indexability could disagree.
test('monthPageSignals: reads holidays.length and events.length', () => {
  const data = { holidays: [{ name: 'x' }], events: [], eventPosts: [] };
  assert.deepEqual(monthPageSignals(data), { hasHolidays: true, hasEvents: false });
});

test('monthPageSignals: eventPosts alone counts as an event', () => {
  const data = { holidays: [], events: [], eventPosts: [{ id: 'p' }] };
  assert.deepEqual(monthPageSignals(data), { hasHolidays: false, hasEvents: true });
});

test('monthPageSignals: neither list populated -> both false', () => {
  const data = { holidays: [], events: [], eventPosts: [] };
  assert.deepEqual(monthPageSignals(data), { hasHolidays: false, hasEvents: false });
});

// Missing arrays (a defensively-shaped caller) must not throw and must read
// as "nothing here", not crash the build.
test('monthPageSignals: tolerates missing eventPosts/events/holidays', () => {
  assert.deepEqual(monthPageSignals({}), { hasHolidays: false, hasEvents: false });
});
