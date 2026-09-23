// What's-closed results renderer.
//
//   node --test src/lib/whats-closed-view.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spanOf, summarize, renderResults, MAX_GRID_ROWS } from './whats-closed-view.mjs';

const S = new Proxy({}, { get: (_, k) => (k === 'planOpenOn' ? 'open {dates}' : k === 'planAvoid' ? 'avoid {dates}' : k === 'moreRows' ? '{n} more' : `[${String(k)}]`) });
// 2026-09-24 is a Thursday.
const data = {
  holidays: [{ date: '2026-09-24', label: 'Constitution Day', local: 'ទិវា' }],
  venues: [
    { slug: 'weekend-market', name: 'Weekend <Market>', city: 'Phnom Penh', closed: [1, 2, 3, 4, 5] },
    { slug: 'art-center', name: 'Art Center', city: 'Siem Reap', closed: [0] },
    { slug: 'always-open', name: 'Always', city: null, closed: [] },
  ],
};

test('span is inclusive, capped, and empty when backwards', () => {
  assert.equal(spanOf('2026-09-24', '2026-09-30').length, 7);
  assert.equal(spanOf('2026-09-24', '2026-12-31').length, 21);
  assert.deepEqual(spanOf('2026-09-30', '2026-09-24'), []);
});

test('rows are places that close at least once, most closed first', () => {
  const s = summarize(data, spanOf('2026-09-24', '2026-09-30'));
  assert.deepEqual(s.rows.map((r) => r.slug), ['weekend-market', 'art-center']);
  assert.equal(s.rows[0].closedCount, 5); // Thu 24, Fri 25, Mon 28, Tue 29, Wed 30
});

test('all-open days exclude holidays and days anyone is shut', () => {
  const s = summarize(data, spanOf('2026-09-24', '2026-09-30'));
  // Sat 26 is the only day nobody is shut and not a holiday (Sun 27: art center).
  assert.deepEqual(s.allOpen, ['2026-09-26']);
});

test('the rendered answer carries dated <time> elements and escapes names', () => {
  const html = renderResults(data, spanOf('2026-09-24', '2026-09-30'), S, 'en-US', '/posts');
  assert.match(html, /<time[^>]*datetime="2026-09-24"/);
  assert.ok(html.includes('Weekend &lt;Market&gt;'));
  assert.ok(!html.includes('<Market>'));
  assert.ok(html.includes('href="/posts/art-center/"'));
});

test('beyond the row cap, the rest become links, not rows', () => {
  const many = { holidays: [], venues: Array.from({ length: MAX_GRID_ROWS + 3 }, (_, i) => ({ slug: `v${i}`, name: `V${i}`, city: null, closed: [1] })) };
  const html = renderResults(many, spanOf('2026-09-28', '2026-09-30'), S, 'en-US', '/posts');
  assert.equal((html.match(/<th scope="row"><a /g) || []).length, MAX_GRID_ROWS);
  assert.match(html, /3 more/);
});
