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
