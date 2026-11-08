import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPastEvent, isOverAtVenue, endsTooSoon, todaySentence } from './event-past.mjs';

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

const at = (iso) => new Date(iso);
const on = (city, last, extra = {}) => ({ city, startDate: last, endDate: last, ...extra });

// The real runs: each guide was written at this instant, the day after the
// last day at the venue, and the UTC check called it "not over".
test('guides born the day after their venue finished are over at the venue', () => {
  const cases = [
    ['La Plata', 'Argentina', '2026-10-24', '2026-10-25T23:06:10Z'],
    ['Tbilisi', 'Georgia', '2026-10-24', '2026-10-25T23:03:24Z'],
    ['Hong Kong', 'Hong Kong', '2026-11-01', '2026-11-02T00:02:51Z'],
    ['Singapore', 'Singapore', '2026-10-17', '2026-10-18T23:06:00Z'],
    ['Paris', 'France', '2026-11-01', '2026-11-02T00:00:51Z'],
  ];
  for (const [city, country, last, when] of cases) {
    assert.equal(isOverAtVenue(on(city, last), country, at(when)), true, city);
    assert.equal(isPastEvent(on(city, last), when.slice(0, 10)), false, city + ' (the old check let it through)');
  }
});

test('a show still on tonight at the venue is not over, whatever UTC says', () => {
  // 00:02 UTC on 11-02 is still the evening of 11-01 in Los Angeles and Honolulu.
  assert.equal(isOverAtVenue(on('Los Angeles', '2026-11-01'), 'United States', at('2026-11-02T00:02:00Z')), false);
  assert.equal(isOverAtVenue(on('Honolulu', '2026-11-01'), 'United States', at('2026-11-02T09:00:00Z')), false);
  // Eleven hours later the same show is over in Los Angeles: the date moved, not an hour rule.
  assert.equal(isOverAtVenue(on('Los Angeles', '2026-11-01'), 'United States', at('2026-11-02T11:00:00Z')), true);
});

test('a venue with no known zone keeps the one-day slack', () => {
  const nowhere = 'Smallville'; // a multi-zone country, a city nobody has placed
  assert.equal(isOverAtVenue(on(nowhere, '2026-11-01'), 'United States', at('2026-11-02T23:00:00Z')), false);
  assert.equal(isOverAtVenue(on(nowhere, '2026-10-31'), 'United States', at('2026-11-02T23:00:00Z')), true);
  assert.equal(isOverAtVenue(on(nowhere, '2026-11-01'), 'Atlantis', at('2026-11-02T23:00:00Z')), false);
  // Too soon reads the same lenient day: UTC yesterday is its "today".
  assert.equal(endsTooSoon(on(nowhere, '2026-11-02'), 'United States', at('2026-11-02T23:00:00Z')), true);
  assert.equal(endsTooSoon(on(nowhere, '2026-11-03'), 'United States', at('2026-11-02T23:00:00Z')), false);
});

test('a one-off ending today or tomorrow at the venue is too soon; two days out is kept', () => {
  const run = at('2026-11-05T01:41:00Z'); // the run that wrote Westlife in Auckland on its only day
  assert.equal(endsTooSoon(on('Auckland', '2026-11-05'), 'New Zealand', run), true);
  assert.equal(endsTooSoon(on('Auckland', '2026-11-06'), 'New Zealand', run), true);
  assert.equal(endsTooSoon(on('Auckland', '2026-11-07'), 'New Zealand', run), false);
  assert.equal(endsTooSoon(on('Auckland', '2026-11-04'), 'New Zealand', run), true);
});

test('the end date decides, never the start', () => {
  const run = at('2026-10-25T23:00:00Z');
  // Mesa's Halloween Cup: two days to go, three days long, 22 Bing clicks.
  assert.equal(endsTooSoon({ city: 'Ulaanbaatar', startDate: '2026-10-27', endDate: '2026-10-29' }, 'Mongolia', run), false);
  // An exhibition that opened weeks ago and runs on.
  assert.equal(endsTooSoon({ city: 'Madrid', startDate: '2026-01-01', endDate: '2026-12-31' }, 'Spain', run), false);
  assert.equal(isOverAtVenue({ city: 'Madrid', startDate: '2026-01-01', endDate: '2026-12-31' }, 'Spain', run), false);
  // Opened long ago, last day tomorrow: too soon.
  assert.equal(endsTooSoon({ city: 'Madrid', startDate: '2026-01-01', endDate: '2026-10-27' }, 'Spain', run), true);
});

test('recurring events are exempt; anything not marked true is a one-off', () => {
  const run = at('2026-11-05T01:41:00Z');
  assert.equal(endsTooSoon(on('Auckland', '2026-11-05', { recurring: true }), 'New Zealand', run), false);
  assert.equal(endsTooSoon(on('Auckland', '2026-11-05', { recurring: false }), 'New Zealand', run), true);
  assert.equal(endsTooSoon(on('Auckland', '2026-11-05'), 'New Zealand', run), true);
});

test('tomorrow means tomorrow at the venue, across a month end', () => {
  const run = at('2026-10-31T12:00:00Z'); // already 11-01 in Auckland, still 10-31 in Honolulu
  assert.equal(endsTooSoon(on('Auckland', '2026-11-02'), 'New Zealand', run), true);
  assert.equal(endsTooSoon(on('Honolulu', '2026-11-02'), 'United States', run), false);
  assert.equal(endsTooSoon(on('Honolulu', '2026-11-01'), 'United States', run), true);
});

test('undated events are left to the no-date gate', () => {
  assert.equal(isOverAtVenue({ city: 'Seoul' }, 'South Korea', at('2026-11-05T00:00:00Z')), false);
  assert.equal(endsTooSoon({ city: 'Seoul', startDate: 'November 2026' }, 'South Korea', at('2026-11-05T00:00:00Z')), false);
});

// The writer is paid after planDiscovered returns; the gates have to be in it.
test('discovery asks both venue-date gates before anything is written', () => {
  const src = readFileSync(new URL('../discover-events.mjs', import.meta.url), 'utf8');
  const plan = src.slice(src.indexOf('function planDiscovered('), src.indexOf('async function writeDiscovered('));
  assert.ok(plan.includes('isOverAtVenue(item, country)'), 'the over-at-venue gate left planDiscovered');
  assert.ok(plan.includes('endsTooSoon(item, country)'), 'the too-soon gate left planDiscovered');
  assert.ok(!src.includes('isPastEvent('), 'discovery went back to the UTC check');
});

test('the search is told the date of the run', () => {
  assert.ok(todaySentence(at('2026-11-05T23:40:00Z')).includes('Today is 2026-11-05;'));
  assert.ok(todaySentence(at('2026-11-06T00:10:00Z')).includes('Today is 2026-11-06;'));
});

test('the event search prompt carries that line and the gates stay behind it', () => {
  const src = readFileSync(new URL('../discover-events.mjs', import.meta.url), 'utf8');
  const prompt = src.slice(src.indexOf('const eventsPrompt ='), src.indexOf('const discoverHotspots ='));
  assert.ok(prompt.includes('todaySentence()'), 'the prompt no longer says what day it is');
  assert.ok(src.includes("name: 'web_search', max_uses: 4"), 'the date line must not change how much a search may spend');
});
