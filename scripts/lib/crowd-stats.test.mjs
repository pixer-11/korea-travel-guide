import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coverage, morningQuiet, peakBusyHour, venue, cityRollup, quotableStats, MIN_CITY_SAMPLE,
} from './crowd-stats.mjs';

const place = (over = {}) => ({
  name: 'Somewhere', city: 'Somecity', country: 'Someland',
  weekdayQuiet: [], weekdayBusy: [], weekendQuiet: [], weekendBusy: [],
  measured: '2026-09-01', ...over,
});

test('coverage counts venues, distinct countries and the measurement window', () => {
  const c = coverage([
    place({ country: 'Japan', measured: '2026-07-23' }),
    place({ country: 'Japan', measured: '2026-09-08' }),
    place({ country: 'Vietnam', measured: '2026-08-01' }),
  ]);
  assert.equal(c.venues, 3);
  assert.equal(c.countries, 2);
  assert.equal(c.measuredFrom, '2026-07-23');
  assert.equal(c.measuredTo, '2026-09-08');
});

test('the morning share is over venues WITH quiet hours, not over all venues', () => {
  // Two venues quiet in the morning, one quiet only in the afternoon, and two
  // with no quiet weekday hours at all. The last two must not dilute the share.
  const m = morningQuiet([
    place({ weekdayQuiet: [8] }),
    place({ weekdayQuiet: [7, 20] }),
    place({ weekdayQuiet: [14] }),
    place({}),
    place({}),
  ]);
  assert.equal(m.withQuietWeekdayHours, 3);
  assert.equal(m.quietInMorning, 2);
  assert.equal(m.share, 2 / 3);
});

test('an hour outside the window does not count as a morning', () => {
  assert.equal(morningQuiet([place({ weekdayQuiet: [6] })]).quietInMorning, 0);
  assert.equal(morningQuiet([place({ weekdayQuiet: [12] })]).quietInMorning, 0);
  // Both edges are inclusive.
  assert.equal(morningQuiet([place({ weekdayQuiet: [7] })]).quietInMorning, 1);
  assert.equal(morningQuiet([place({ weekdayQuiet: [11] })]).quietInMorning, 1);
});

test('with no quiet hours anywhere the share is null, not 0 or NaN', () => {
  const m = morningQuiet([place({}), place({})]);
  assert.equal(m.withQuietWeekdayHours, 0);
  assert.equal(m.share, null);
});

test('the peak busy hour is the most common one, counted per venue', () => {
  const p = peakBusyHour([
    place({ weekdayBusy: [12, 13] }),
    place({ weekdayBusy: [13] }),
    place({ weekdayBusy: [13, 14] }),
    place({}),
  ]);
  assert.equal(p.hour, 13);
  assert.equal(p.venues, 3);
  assert.equal(p.withBusyWeekdayHours, 3);
});

test('a tie breaks to the earlier hour so the number is stable week to week', () => {
  const p = peakBusyHour([place({ weekdayBusy: [9] }), place({ weekdayBusy: [17] })]);
  assert.equal(p.hour, 9);
});

test('city means are never quotable and say why, with the real sample range', () => {
  const r = cityRollup([
    place({ city: 'Kyoto', weekdayBusy: [9, 10, 11, 12] }),
    place({ city: 'Kyoto', weekdayBusy: [10] }),
    place({ city: 'Rome', weekdayBusy: [] }),
  ]);
  assert.equal(r.quotable, false);
  assert.match(r.reason, /1–2/);
  assert.match(r.reason, /named venue/);
  assert.equal(r.minSampleForAnyUse, MIN_CITY_SAMPLE);
  // The means are still computed — the refusal is about quoting, not arithmetic.
  assert.equal(r.cities[0].city, 'Kyoto');
  assert.equal(r.cities[0].meanBusyWeekdayHours, 2.5);
});

test('quotableStats carries no city numbers at all', () => {
  const s = quotableStats([place({ city: 'Kyoto', weekdayQuiet: [8] })]);
  assert.deepEqual(Object.keys(s).sort(), ['coverage', 'morningQuiet', 'peakBusyHour']);
});

test('a venue lookup prefers an exact name over a substring match', () => {
  const places = [
    place({ name: 'Nara Park Visitor Centre', weekdayQuiet: [15] }),
    place({ name: 'Nara Park', weekdayQuiet: [7], weekdayBusy: [10, 11] }),
  ];
  const v = venue(places, 'nara park');
  assert.equal(v.name, 'Nara Park');
  assert.deepEqual(v.weekdayBusy, [10, 11]);
  assert.equal(venue(places, 'no such place'), null);
});

test('a venue with missing hour arrays is read as empty, not as a crash', () => {
  const v = venue([{ name: 'Bare', city: 'C', country: 'X' }], 'Bare');
  assert.deepEqual(v.weekdayQuiet, []);
  assert.equal(morningQuiet([{ name: 'Bare' }]).withQuietWeekdayHours, 0);
  assert.equal(peakBusyHour([{ name: 'Bare' }]).hour, null);
});
