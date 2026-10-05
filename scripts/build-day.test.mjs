// One "today" per build (lib/buildDay.mjs). 10-03: the sitemap and two event
// pages disagreed across 00:00 UTC; Codex then found the events hubs, the .ics
// feeds and events.md still reading the clock. Any new `today = new Date()` in
// page code brings that back, so it fails here.
//   node --test scripts/build-day.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  if (statSync(p).isDirectory()) return f === 'content' ? [] : walk(p);
  return /\.(astro|ts|mjs)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
});

test('page code takes "today" from lib/buildDay.mjs, not the clock', () => {
  const bad = walk(SRC).filter((p) => !p.endsWith('buildDay.mjs')
    && /\btoday\s*=\s*new Date\(\)/.test(readFileSync(p, 'utf8')))
    .map((p) => p.slice(SRC.length));
  assert.deepEqual(bad, []);
});

// 10-05 audit: the rule above only matched the literal `today = new Date()`, so
// `const now = new Date()` (country hub event counts), `Date.now() + 13 days`
// (what's-closed window) and eight more slipped past it. A component's server
// code — its frontmatter, not its <script> blocks, which are the reader's-date
// layer — never reads the wall clock.
test('no .astro frontmatter reads the wall clock', () => {
  const bad = [];
  for (const p of walk(SRC).filter((x) => x.endsWith('.astro'))) {
    const fm = readFileSync(p, 'utf8').replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    fm.split('\n').forEach((l, i) => {
      if (/new Date\(\)|Date\.now\(\)/.test(l) && !/^\s*\/\//.test(l)) bad.push(`${p.slice(SRC.length)}:${i + 2}`);
    });
  }
  assert.deepEqual(bad, [], 'use buildToday() from lib/buildDay.mjs');
});

test('the build day holds across midnight UTC (Codex, 10-04)', async () => {
  process.env.WA_BUILD_DAY = '2026-10-02';
  const { eventGroupOf } = await import('../src/lib/eventGroups.mjs');
  const { buildToday } = await import('../src/lib/buildDay.mjs');
  assert.equal(buildToday().toISOString().slice(0, 10), '2026-10-02');
  // Starting the day after the build day: still "upcoming" in this build, even
  // though the wall clock running this test is already past 10-03.
  const g = eventGroupOf({ category: 'event', eventStartDate: '2026-10-03', eventEndDate: '2026-10-05' });
  assert.equal(g.kind, 'month');
  delete process.env.WA_BUILD_DAY;
});
