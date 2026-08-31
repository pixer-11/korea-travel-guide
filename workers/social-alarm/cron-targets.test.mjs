// The alarm clock is two files that must agree: wrangler.jsonc says WHEN
// Cloudflare wakes this worker, worker.mjs's SCHEDULE says WHAT each of those
// wake-ups dispatches. Neither file can detect the other drifting at runtime —
// a cron with no SCHEDULE key silently falls back to firing everything, and a
// SCHEDULE key with no cron is a workflow nobody wakes and nobody misses until
// a day's work is gone. Both failures are quiet, which is why they are tested.
//
// It also pins the thing the alarm exists for (2026-08-31): every GitHub cron
// we back up must actually be behind ours, and only just behind — fire too
// early and we race the real run instead of covering for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SCHEDULE, ALL_TARGETS, targetsFor } from './worker.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// wrangler.jsonc is JSON with // comments; strip them rather than add a dep.
// The alternation matches whole quoted strings first so a "//" living inside
// one is handed back untouched — otherwise a URL value would eat the rest of
// its line. Trailing commas go after, since JSONC allows them and JSON does not.
const stripJsonc = (s) =>
  s
    .replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*/g, (m) => (m.startsWith('"') ? m : ''))
    .replace(/,(\s*[}\]])/g, '$1');

const wrangler = JSON.parse(stripJsonc(readFileSync(here('./wrangler.jsonc'), 'utf8')));

const minutesUTC = (cron) => {
  const [m, h] = cron.split(/\s+/);
  return Number(h) * 60 + Number(m);
};

test('every Cloudflare cron has a SCHEDULE entry saying what it wakes', () => {
  for (const cron of wrangler.triggers.crons) {
    assert.ok(SCHEDULE[cron], `wrangler cron "${cron}" has no key in worker.mjs SCHEDULE — it would wake ALL targets every day`);
  }
});

test('every SCHEDULE entry has a Cloudflare cron that fires it', () => {
  for (const cron of Object.keys(SCHEDULE)) {
    assert.ok(wrangler.triggers.crons.includes(cron), `SCHEDULE key "${cron}" is not in wrangler.jsonc — nothing ever wakes it`);
  }
});

test('the account cron budget is not overspent', () => {
  // Cloudflare free plan: 5 cron triggers per ACCOUNT, and this is the only
  // worker on it with any. Verified against the platform limits page 2026-08-31.
  assert.ok(wrangler.triggers.crons.length <= 5, 'more crons than the free plan allows per account');
});

test('each target workflow exists and its own cron is just before ours', () => {
  for (const [cron, targets] of Object.entries(SCHEDULE)) {
    for (const wf of targets) {
      const src = readFileSync(here('../../.github/workflows/' + wf), 'utf8');
      // Line-anchored: commented-out crons are intent, not schedule.
      const theirs = [...src.matchAll(/^\s+- cron:\s*['"]?([^'"#\n]+?)['"]?\s*(?:#.*)?$/gm)].map((m) => m[1].trim());
      assert.ok(theirs.length, `${wf} has no active cron — is the alarm waking something that no longer runs on a schedule?`);
      const ours = minutesUTC(cron);
      // Some window before us, within an hour: close enough that a punctual
      // GitHub run is still in flight and the day guard absorbs us.
      const gaps = theirs
        .filter((c) => /^\d{1,2} \d{1,2} /.test(c))
        .map((c) => (ours - minutesUTC(c) + 1440) % 1440);
      assert.ok(gaps.some((g) => g > 0 && g <= 60), `${wf}: no GitHub cron in the hour before ${cron} (gaps: ${gaps.join(',')}) — the alarm would race the real run instead of covering it`);
    }
  }
});

test('an unrecognised cron wakes everything rather than nothing', () => {
  assert.deepEqual(targetsFor('9 9 9 9 9'), ALL_TARGETS);
  assert.ok(ALL_TARGETS.length >= 3);
});
