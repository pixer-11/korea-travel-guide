// Every holiday-overlap string in all five language blocks — a missing one
// leaks English onto a localized page silently (same check as whats-closed).
//
//   node --test src/i18n/holiday-overlap-keys.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const UI = readFileSync(new URL('./ui.ts', import.meta.url), 'utf8');

const KEYS = [
  'ho.title', 'ho.dek', 'ho.peaksHeading', 'ho.countriesOff', 'ho.daysOff',
  'ho.tableHeading', 'ho.weekOf', 'ho.method', 'ho.caveat', 'ho.license',
  'ho.csv', 'ho.ics', 'ho.quietLink',
];

test('every holiday-overlap string exists in all five languages', () => {
  for (const key of KEYS) {
    const count = UI.split(`'${key}':`).length - 1;
    assert.equal(count, 5, `${key} defined ${count} time(s), expected 5`);
  }
});
