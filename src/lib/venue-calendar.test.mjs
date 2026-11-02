import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closedOn, calendarExceptions, inRange, holidaySet } from './venue-calendar.mjs';

// Shinjuku Gyoen's official rules (fng.or.jp/shinjuku/en/, checked 2026-11-02).
const GYOEN = { closedWeekdays: ['Monday'], holidayShift: true, openDaily: [['03-25', '04-24'], ['11-01', '11-15']], closedRanges: [['12-29', '01-03']] };
// Japan 2026: Labour Thanksgiving Day is Mon 11-23; Respect for the Aged Day Mon 09-21, Autumnal Equinox Tue 09-22.
const JP = new Set(['2026-09-21', '2026-09-22', '2026-11-03', '2026-11-23', '2027-01-01', '2027-01-11']);

test('11-02 (a Monday in the autumn special period) is OPEN — the false alarm the review praised', () => {
  assert.equal(closedOn('2026-11-02', GYOEN, JP), false);
  assert.equal(closedOn('2026-11-09', GYOEN, JP), false);
});

test('a holiday Monday opens and the closure moves to the next weekday', () => {
  assert.equal(closedOn('2026-11-23', GYOEN, JP), false); // Mon, holiday
  assert.equal(closedOn('2026-11-24', GYOEN, JP), true);  // Tue, the shifted closure
  assert.equal(closedOn('2026-11-25', GYOEN, JP), false);
  // Mon 09-21 and Tue 09-22 both holidays → Wednesday closes.
  assert.equal(closedOn('2026-09-22', GYOEN, JP), false);
  assert.equal(closedOn('2026-09-23', GYOEN, JP), true);
});

test('an ordinary Monday stays closed; year-end closes every day', () => {
  assert.equal(closedOn('2026-11-16', GYOEN, JP), true);
  assert.equal(closedOn('2026-12-30', GYOEN, JP), true);  // Wed in Dec 29 – Jan 3
  assert.equal(closedOn('2027-01-01', GYOEN, JP), true);  // holiday, but year-end range wins
  assert.equal(closedOn('2027-01-04', GYOEN, JP), true);  // Mon after the range: regular closure
});

test('ranges wrap over the new year', () => {
  assert.equal(inRange('12-31', ['12-29', '01-03']), true);
  assert.equal(inRange('01-02', ['12-29', '01-03']), true);
  assert.equal(inRange('01-04', ['12-29', '01-03']), false);
});

test('exceptions list exactly the disagreements with the plain weekday list', () => {
  const { openOn, closedOn: shut } = calendarExceptions(GYOEN, JP, '2026-11-01', 30);
  assert.deepEqual(openOn, ['2026-11-02', '2026-11-09', '2026-11-23']);
  assert.deepEqual(shut, ['2026-11-24']);
});

test('no holiday shift → only ranges change the weekday list', () => {
  const plain = { closedWeekdays: ['Tuesday'], openDaily: [], closedRanges: [['12-31', '01-01']] };
  assert.equal(closedOn('2026-11-24', plain, JP), true);
  assert.equal(closedOn('2026-11-25', plain, JP), false);
  assert.equal(closedOn('2026-12-31', plain, JP), true);
});

test('Japan holidays come from data/country-facts.json and include 2026-11-23', () => {
  const facts = JSON.parse(readFileSync(new URL('../../data/country-facts.json', import.meta.url), 'utf8'));
  assert.ok(holidaySet(facts, 'Japan').has('2026-11-23'));
  assert.equal(holidaySet(facts, 'Nowhere').size, 0);
});

test('a year the holiday list does not reach keeps the weekday rule — no guessed shift (Codex 11-02)', () => {
  // JP list here covers 2026 and 2027 only. 2028-01-10 (Coming of Age Day, a Monday) is unknown:
  // plain Monday closure, and no shifted closure on Tuesday 01-11.
  assert.equal(closedOn('2028-01-10', GYOEN, JP), true);
  assert.equal(closedOn('2028-01-11', GYOEN, JP), false);
  // Ranges still apply in an unknown year.
  assert.equal(closedOn('2028-12-30', GYOEN, JP), true);
  assert.equal(closedOn('2028-11-06', GYOEN, JP), false); // Monday in the autumn open period
});
