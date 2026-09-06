// The tool answers a date question from two facts we hold: holiday dates in
// data/country-facts.json and each venue's ordinary weekly hours from Google
// Places. Pure functions over data passed in, so this runs in plain node.
//
//   node --test src/lib/whats-closed.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eachDateInRange, weekdayOf, holidaysInRange, closedWeekdaysOf, closuresInRange,
} from './whats-closed.mjs';

const FACTS = {
  updated: '2026-09-03',
  countries: {
    Japan: {
      holidays: [
        { date: '2026-12-31', localName: '大晦日', name: "New Year's Eve" },
        { date: '2027-01-01', localName: '元日', name: "New Year's Day" },
        { date: '2026-03-20', localName: '春分の日', name: 'Vernal Equinox Day' },
      ],
    },
    Thailand: { holidays: [] },
  },
};

const WEEK = (closed) => [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
].map((d) => (closed.includes(d) ? `${d}: Closed` : `${d}: 9:00 AM – 5:00 PM`));

const post = (over = {}) => ({
  id: over.id ?? 'tokyo-museum.md',
  data: {
    country: over.country ?? 'Japan',
    region: 'Tokyo',
    place: { name: over.name ?? 'Tokyo Museum', openingHours: over.hours, ...(over.place ?? {}) },
  },
});

test('eachDateInRange is inclusive and ascending', () => {
  assert.deepEqual(eachDateInRange('2026-03-14', '2026-03-17'),
    ['2026-03-14', '2026-03-15', '2026-03-16', '2026-03-17']);
});

test('eachDateInRange crosses a month and a year without drifting', () => {
  assert.deepEqual(eachDateInRange('2026-01-30', '2026-02-02'),
    ['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']);
  assert.deepEqual(eachDateInRange('2026-12-30', '2027-01-02'),
    ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
});

test('eachDateInRange refuses nonsense instead of hanging', () => {
  assert.deepEqual(eachDateInRange('2026-03-17', '2026-03-14'), []);
  assert.deepEqual(eachDateInRange('not a date', '2026-03-14'), []);
  assert.equal(eachDateInRange('2026-01-01', '2026-12-31').length, 60);
});

test('weekdayOf reads the UTC day, so a date is the same weekday everywhere', () => {
  assert.equal(weekdayOf('2026-03-16'), 'Monday');
  assert.equal(weekdayOf('2026-03-22'), 'Sunday');
  assert.equal(weekdayOf('nope'), null);
});

test('holidaysInRange returns only what falls inside, in date order', () => {
  assert.deepEqual(
    holidaysInRange(FACTS, 'Japan', '2026-12-30', '2027-01-02').map((h) => h.date),
    ['2026-12-31', '2027-01-01'],
  );
});

test('holidaysInRange is empty, never undefined, when there is nothing to say', () => {
  assert.deepEqual(holidaysInRange(FACTS, 'Thailand', '2026-01-01', '2026-01-31'), []);
  assert.deepEqual(holidaysInRange(FACTS, 'Narnia', '2026-01-01', '2026-01-31'), []);
  assert.deepEqual(holidaysInRange(null, 'Japan', '2026-01-01', '2026-01-31'), []);
});

test('closedWeekdaysOf reads every closed day, not just the first', () => {
  assert.deepEqual(closedWeekdaysOf(post({ hours: WEEK(['Monday', 'Tuesday']) })),
    ['Monday', 'Tuesday']);
});

test('closedWeekdaysOf says nothing about a venue whose hours belong to another entity', () => {
  const wrong = post({ hours: WEEK(['Monday']), place: { hoursOmitted: 'park office hours' } });
  assert.deepEqual(closedWeekdaysOf(wrong), []);
  assert.deepEqual(closedWeekdaysOf(post({})), []);
});

test('closuresInRange lists a day only when something is shut on it', () => {
  const posts = [
    post({ id: 'a.md', hours: WEEK(['Monday']), name: 'B Museum' }),
    post({ id: 'b.md', hours: WEEK(['Monday']), name: 'A Gallery' }),
    post({ id: 'c.md', hours: WEEK(['Thursday']), name: 'C Garden' }),
  ];
  const out = closuresInRange(posts, { country: 'Japan', fromISO: '2026-03-16', toISO: '2026-03-18' });
  assert.deepEqual(out.map((d) => d.date), ['2026-03-16']);
  assert.deepEqual(out[0].venues.map((v) => v.name), ['A Gallery', 'B Museum']);
  assert.equal(out[0].venues[0].slug, 'b');
  assert.equal(out[0].weekday, 'Monday');
});

test('closuresInRange keeps to the country asked for', () => {
  const posts = [
    post({ id: 'jp.md', hours: WEEK(['Monday']) }),
    post({ id: 'th.md', hours: WEEK(['Monday']), country: 'Thailand', name: 'Wat Arun' }),
  ];
  const out = closuresInRange(posts, { country: 'Japan', fromISO: '2026-03-16', toISO: '2026-03-16' });
  assert.deepEqual(out[0].venues.map((v) => v.name), ['Tokyo Museum']);
});

test('closuresInRange survives empty and malformed input', () => {
  assert.deepEqual(closuresInRange([], { country: 'Japan', fromISO: '2026-03-16', toISO: '2026-03-18' }), []);
  assert.deepEqual(closuresInRange(null, { country: 'Japan', fromISO: '2026-03-16', toISO: '2026-03-18' }), []);
  assert.deepEqual(closuresInRange([post({ hours: WEEK(['Monday']) })], { country: 'Japan', fromISO: 'x', toISO: 'y' }), []);
});
