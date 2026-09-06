// Adding a page means adding its strings to five language blocks by hand. Miss one
// and the failure is silent — English leaks into a Korean page. Same registration
// check the essentials topics gained on 2026-09-05.
//
//   node --test src/i18n/whats-closed-keys.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const UI = readFileSync(new URL('./ui.ts', import.meta.url), 'utf8');

const KEYS = [
  'wc.title', 'wc.dek', 'wc.country', 'wc.from', 'wc.to', 'wc.check',
  'wc.holidaysHeading', 'wc.noHolidays', 'wc.closedHeading', 'wc.noClosures',
  'wc.caveat', 'wc.hoursSource', 'wc.quietLink',
];

test('every whats-closed string exists in all five languages', () => {
  for (const key of KEYS) {
    const count = UI.split(`'${key}':`).length - 1;
    assert.equal(count, 5, `${key} defined ${count} time(s), expected 5`);
  }
});
