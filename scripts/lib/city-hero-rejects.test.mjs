import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wasRejected, rememberRejection, pruneRejections, rejectKey, REJECTS_FILE } from './city-hero-rejects.mjs';

const URL_A = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Qasr_Al_Watan.jpg';
const NOW = Date.parse('2026-11-08T00:00:00Z');
const DAY = 864e5;

test('a rejected photo is skipped for that city only, and only for 30 days', () => {
  const store = {};
  assert.equal(wasRejected(store, 'Abu Dhabi', URL_A, NOW), false);
  assert.equal(rememberRejection(store, 'Abu Dhabi', URL_A, 'Shows an ambulance van, not a city view', NOW), true);
  assert.equal(wasRejected(store, 'Abu Dhabi', URL_A, NOW + DAY), true);
  assert.equal(wasRejected(store, 'Dubai', URL_A, NOW + DAY), false, 'the verdict was about Abu Dhabi');
  assert.equal(wasRejected(store, 'Abu Dhabi', URL_A, NOW + 31 * DAY), false, 'the judge gets another look');
});

test('the same file under a tracking query or the thumb host is the same file', () => {
  const store = {};
  rememberRejection(store, 'Hue', `${URL_A}?utm_source=commons.wikimedia.org`, 'no', NOW);
  assert.equal(wasRejected(store, 'Hue', URL_A, NOW), true);
});

test('an outage is not a verdict: nothing is recorded', () => {
  for (const reason of [
    'vision unavailable (overloaded) — not approved',
    'no-api-key — refusing to approve unchecked',
    'vision check failed (timeout)',
    'image unusable: fetch failed 502',
    'candidate unusable: too large',
  ]) {
    const store = {};
    assert.equal(rememberRejection(store, 'Hue', URL_A, reason, NOW), false, reason);
    assert.deepEqual(store, {}, reason);
  }
});

test('a model reply that merely starts like an outage is still a verdict', () => {
  const store = {};
  assert.equal(rememberRejection(store, 'Hue', URL_A, 'Image unusable: visible watermark', NOW), true);
  assert.equal(wasRejected(store, 'Hue', URL_A, NOW), true);
});

test('rows past the window are pruned, unreadable rows too, fresh rows stay', () => {
  const store = {
    [rejectKey('Hue', URL_A)]: { reason: 'old', at: new Date(NOW - 40 * DAY).toISOString() },
    [rejectKey('Hanoi', URL_A)]: { reason: 'fresh', at: new Date(NOW - 2 * DAY).toISOString() },
    [rejectKey('Hoi An', URL_A)]: { reason: 'no date' },
  };
  assert.equal(pruneRejections(store, NOW), true);
  assert.deepEqual(Object.keys(store), [rejectKey('Hanoi', URL_A)]);
  assert.equal(pruneRejections(store, NOW), false);
});

test('the rejection ledger is written, committed, and never wakes a build', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.match(read('../fill-event-city-heroes.mjs'), /rememberRejection\(/);
  assert.ok(read('../../.github/workflows/alt-photos.yml').includes(REJECTS_FILE), 'alt-photos.yml must stage it or every night starts over');
  assert.ok(read('../../.github/workflows/build-check.yml').includes(`'!${REJECTS_FILE}'`), 'bookkeeping the build never reads');
});
