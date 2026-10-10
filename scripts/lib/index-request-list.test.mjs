import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexRequestPool, pickIndexRequests, indexRequestLines, loadPostsForIndexRequests, loadIndexRequestPins, PER_DAY } from './index-request-list.mjs';
import { fileURLToPath } from 'node:url';

const posts = [
  { slug: 'old-indexed', category: 'attraction', pubDate: '2026-07-01', eventStartDate: '', draft: false },
  { slug: 'held', category: 'attraction', pubDate: '2026-10-01', eventStartDate: '', draft: true },
  { slug: 'ev-soon', category: 'event', pubDate: '2026-09-20', eventStartDate: '2026-10-12', draft: false },
  { slug: 'ev-later', category: 'event', pubDate: '2026-09-21', eventStartDate: '2026-11-20', draft: false },
  { slug: 'ev-far', category: 'event', pubDate: '2026-09-22', eventStartDate: '2027-03-01', draft: false },
  { slug: 'ev-over', category: 'event', pubDate: '2026-09-01', eventStartDate: '2026-09-15', draft: false },
  { slug: 'new-a', category: 'restaurant', pubDate: '2026-10-08', eventStartDate: '', draft: false },
  { slug: 'new-b', category: 'attraction', pubDate: '2026-10-09', eventStartDate: '', draft: false },
];

test('pool: soon events first by date, then newest posts; drafts, pre-freeze and ended events excluded', () => {
  const pool = indexRequestPool(posts, '2026-10-09').map((p) => p.slug);
  assert.deepEqual(pool, ['ev-soon', 'ev-later', 'new-b', 'new-a', 'ev-far']);
});

test('pick: ten a day, rotating so consecutive days do not repeat until the pool cycles', () => {
  const many = Array.from({ length: 35 }, (_, i) => ({ slug: `p${String(i).padStart(2, '0')}`, category: 'attraction', pubDate: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, eventStartDate: '', draft: false }));
  const d1 = pickIndexRequests(many, '2026-10-09').map((p) => p.slug);
  const d2 = pickIndexRequests(many, '2026-10-10').map((p) => p.slug);
  assert.equal(d1.length, PER_DAY);
  assert.equal(new Set([...d1, ...d2]).size, 20, 'two days list twenty different pages');
  assert.deepEqual(pickIndexRequests(many, '2026-10-09'), pickIndexRequests(many, '2026-10-09'), 'deterministic per day');
});

test('pick: a pool smaller than the ration returns the whole pool once', () => {
  assert.equal(pickIndexRequests(posts, '2026-10-09').length, 5);
  assert.deepEqual(pickIndexRequests([], '2026-10-09'), []);
});

test('lines: one URL per line, events tagged with their date, nothing when empty', () => {
  const lines = indexRequestLines(pickIndexRequests(posts, '2026-10-09'), '2026-10-09');
  assert.match(lines[0], /색인 요청 5건/);
  assert.equal(lines[1], '• https://wanderatlasguides.com/posts/ev-soon/ (행사 10-12)');
  assert.equal(lines[3], '• https://wanderatlasguides.com/posts/new-b/');
  assert.deepEqual(indexRequestLines([], '2026-10-09'), []);
});

test('loader reads the real posts directory into minimal records', () => {
  const dir = fileURLToPath(new URL('../../src/content/posts/', import.meta.url));
  const all = loadPostsForIndexRequests(dir);
  assert.ok(all.length > 1000);
  const p = all.find((x) => x.slug === 'incheon-wolmi-theme-park');
  assert.ok(p && p.category === 'attraction' && /^\d{4}-\d{2}-\d{2}$/.test(p.pubDate));
  const pool = indexRequestPool(all, '2026-10-09');
  assert.ok(pool.length > 100, 'the pool of never-indexed posts is large');
  assert.ok(pool.every((x) => !x.draft && x.pubDate >= '2026-07-25'));
});

test('pins go first within their window and never count against the rotation', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ slug: `p${String(i).padStart(2, '0')}`, category: 'attraction', pubDate: '2026-09-15', eventStartDate: '', draft: false }));
  many.push({ slug: 'retitled', category: 'attraction', pubDate: '2026-07-21', eventStartDate: '', draft: false }); // pre-freeze: not in the pool
  const withPins = pickIndexRequests(many, '2026-10-10', { pins: ['retitled', 'missing-slug'] }).map((p) => p.slug);
  assert.equal(withPins[0], 'retitled');
  assert.equal(withPins.length, PER_DAY);
  const without = pickIndexRequests(many, '2026-10-10', { pins: [] }).map((p) => p.slug);
  assert.deepEqual(withPins.slice(1), without.slice(0, PER_DAY - 1), 'the rotating window is the same, just one shorter');
});

test('the committed pins file loads and expired rows drop out', () => {
  const now = loadIndexRequestPins('2026-10-10');
  assert.ok(now.includes('incheon-wolmi-theme-park'));
  assert.deepEqual(loadIndexRequestPins('2027-01-01'), []);
});
