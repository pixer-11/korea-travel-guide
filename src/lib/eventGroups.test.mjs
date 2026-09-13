import test from 'node:test';
import assert from 'node:assert/strict';
import { eventGroupOf, groupUpcomingEvents } from './eventGroups.mjs';

const TODAY = new Date('2026-09-14T00:00:00Z');
const LABELS = { now: 'NOW', tba: 'TBA', month: (d) => d.toISOString().slice(0, 7) };

test('a run that opened months ago is on now, not filed under its opening month', () => {
  // Yoko Ono, Istanbul: 2026-06-25 → 2026-12-15. This is the case that put a
  // "June 2026" heading at the top of the hub in September.
  assert.equal(eventGroupOf({ eventStartDate: '2026-06-25' }, TODAY).kind, 'now');
});

test('an event that starts today is on now', () => {
  assert.equal(eventGroupOf({ eventStartDate: '2026-09-14' }, TODAY).kind, 'now');
});

test('an event that starts tomorrow keeps its month heading', () => {
  const g = eventGroupOf({ eventStartDate: '2026-09-15' }, TODAY);
  assert.equal(g.kind, 'month');
  assert.equal(g.start.toISOString().slice(0, 10), '2026-09-15');
});

test('missing or unparseable start dates fall back to date-TBA', () => {
  assert.equal(eventGroupOf({}, TODAY).kind, 'tba');
  assert.equal(eventGroupOf({ eventStartDate: 'someday' }, TODAY).kind, 'tba');
});

test('groups read: on now, then future months in caller order, then undated', () => {
  const out = groupUpcomingEvents(
    [
      { id: 'ongoing', data: { eventStartDate: '2026-06-25' } },
      { id: 'oct', data: { eventStartDate: '2026-10-01' } },
      { id: 'oct2', data: { eventStartDate: '2026-10-20' } },
      { id: 'nov', data: { eventStartDate: '2026-11-03' } },
      { id: 'undated', data: {} },
    ],
    LABELS,
    TODAY,
  );
  assert.deepEqual(
    out.map(([k, v]) => [k, v.map((p) => p.id)]),
    [['NOW', ['ongoing']], ['2026-10', ['oct', 'oct2']], ['2026-11', ['nov']], ['TBA', ['undated']]],
  );
});

test('empty groups produce no heading at all', () => {
  const out = groupUpcomingEvents([{ id: 'oct', data: { eventStartDate: '2026-10-01' } }], LABELS, TODAY);
  assert.deepEqual(out.map(([k]) => k), ['2026-10']);
  assert.deepEqual(groupUpcomingEvents([], LABELS, TODAY), []);
});
