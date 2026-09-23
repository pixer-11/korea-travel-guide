// Asia holiday-overlap arithmetic.
//
//   node --test src/lib/holiday-overlap.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mondayOf, overlapWeeks, peakWeeks, overlapCsv, SOURCE_MARKETS } from './holiday-overlap.mjs';

const facts = {
  countries: {
    China: { holidays: [
      { date: '2026-10-01', name: 'National Day', localName: '国庆节' },     // Thu
      { date: '2026-10-02', name: 'National Day', localName: '国庆节' },     // Fri
      { date: '2026-10-03', name: 'National Day', localName: '国庆节' },     // Sat — no day off
    ] },
    'South Korea': { holidays: [
      { date: '2026-09-28', name: 'Chuseok', localName: '추석' },            // Mon
      { date: '2026-09-28', name: 'Other', localName: '다른' },              // same date → one day
    ] },
    Japan: { holidays: [{ date: '2026-10-10', name: 'Sat holiday', localName: '土' }] }, // Sat only
  },
};

test('weeks start on Monday', () => {
  assert.equal(mondayOf('2026-10-01'), '2026-09-28'); // Thursday → Monday
  assert.equal(mondayOf('2026-09-28'), '2026-09-28'); // Monday stays
  assert.equal(mondayOf('2026-10-04'), '2026-09-28'); // Sunday → the Monday before
});

test('counts weekday days off, not names, and ignores weekend holidays', () => {
  const [w] = overlapWeeks(facts, { fromISO: '2026-09-30', weeks: 1 });
  assert.equal(w.start, '2026-09-28');
  assert.equal(w.end, '2026-10-04');
  assert.equal(w.score, 2, 'China and Korea are off; nobody else');
  const cn = w.markets.find((m) => m.country === 'China');
  assert.equal(cn.days, 2, 'Saturday 3 Oct gives no day off');
  const kr = w.markets.find((m) => m.country === 'South Korea');
  assert.equal(kr.days, 1, 'two names on one date are one day');
});

test('a week whose only holiday falls on Saturday scores zero', () => {
  const [w] = overlapWeeks(facts, { fromISO: '2026-10-05', weeks: 1 });
  assert.equal(w.score, 0);
});

test('peak weeks need at least two countries and put the widest first', () => {
  const weeks = overlapWeeks(facts, { fromISO: '2026-09-21', weeks: 4 });
  const peaks = peakWeeks(weeks);
  assert.equal(peaks.length, 1);
  assert.equal(peaks[0].start, '2026-09-28');
});

test('CSV quotes names with commas and has one row per country-week', () => {
  const csv = overlapCsv([{ start: 'a', end: 'b', score: 1, markets: [{ country: 'X', days: 1, holidays: [{ date: 'd', name: 'Commemoration of Atatürk, Youth and Sports Day' }] }] }]);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /"Commemoration of Atatürk, Youth and Sports Day"$/);
});

test('every source market exists in the real data with holidays', () => {
  const real = JSON.parse(readFileSync(new URL('../../data/country-facts.json', import.meta.url), 'utf8'));
  for (const c of SOURCE_MARKETS) {
    assert.ok((real.countries[c]?.holidays ?? []).length > 0, `${c} has no holidays in country-facts.json`);
  }
});
