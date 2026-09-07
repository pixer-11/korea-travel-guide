import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, byNewest } from './date-key.mjs';

test('a Date and the same instant as a string produce the same key', () => {
  const iso = '2026-07-26T07:56:04.606Z';
  assert.equal(dateKey(new Date(iso)), dateKey(iso));
});

test('a bare YAML date and a quoted one sort against each other correctly', () => {
  // The bug in one line: String(new Date('2026-07-26')) starts with "Sun",
  // String('2026-08-01T…') starts with "2026", and "S" > "2" — so the JULY post
  // sorted as if it were newer than the AUGUST one.
  const july = new Date('2026-07-26T00:00:00Z');   // bare in frontmatter
  const august = '2026-08-01T09:00:00.000Z';       // quoted in frontmatter
  assert.ok(String(july).localeCompare(String(august)) > 0, 'the old key really was backwards');
  assert.ok(dateKey(august) > dateKey(july), 'August is newer');
});

test('byNewest puts the newest first across mixed shapes', () => {
  const posts = [
    { id: 'old-string', d: '2026-01-05T00:00:00.000Z' },
    { id: 'new-date', d: new Date('2026-09-06T00:00:00Z') },
    { id: 'mid-string', d: '2026-05-05T00:00:00.000Z' },
  ];
  assert.deepEqual([...posts].sort(byNewest((p) => p.d)).map((p) => p.id), ['new-date', 'mid-string', 'old-string']);
});

test('a missing date sorts last rather than crashing', () => {
  const posts = [{ id: 'none', d: undefined }, { id: 'dated', d: '2026-01-01T00:00:00.000Z' }];
  assert.deepEqual([...posts].sort(byNewest((p) => p.d)).map((p) => p.id), ['dated', 'none']);
  assert.equal(dateKey(undefined), '');
  assert.equal(dateKey(null), '');
  assert.equal(dateKey(''), '');
});

test('an invalid date keeps its own text instead of collapsing to one value', () => {
  assert.equal(dateKey('not a date'), 'not a date');
  assert.equal(dateKey('also not'), 'also not');
  assert.notEqual(dateKey('not a date'), dateKey('also not'));
  assert.equal(dateKey(new Date('nonsense')), '');
});
