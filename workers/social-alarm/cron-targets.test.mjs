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
import { SCHEDULE, SMOKE_TARGETS, TICK_MS, dueTargets } from './worker.mjs';
import { MANIFEST } from '../../scripts/lib/cron-manifest.mjs';

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

test('Cloudflare wakes the table every five minutes, no more and no less', () => {
  assert.deepEqual(wrangler.triggers.crons, ['*/5 * * * *']);
  assert.equal(TICK_MS, 5 * 60000);
});

const nameOf = (t) => (typeof t === 'string' ? t : t.workflow);
const alarmOnly = MANIFEST.filter((w) => w.alarmOnly);

// A whole week of ticks, the real sequence the alarm will see.
const firings = () => {
  const start = Date.UTC(2026, 10, 9);
  const out = [];
  for (let t = start; t < start + 7 * 86400000; t += TICK_MS) {
    for (const target of dueTargets(t)) out.push({ t, name: nameOf(target), target });
  }
  return out;
};

test('over a week every slot fires exactly once, on the first tick at or after it', () => {
  const expected = new Map();
  for (const [cron, targets] of Object.entries(SCHEDULE)) {
    const [minute, hour, , , dow] = cron.split(/\s+/);
    const days = dow === '*' ? 7 : dow.includes('-') ? 6 : 1;
    const tick = Number(hour) * 60 + Math.ceil(Number(minute) / 5) * 5;
    for (const wf of targets.map(nameOf)) {
      const key = `${wf}@${tick}`;
      expected.set(key, (expected.get(key) ?? 0) + days);
    }
  }
  const seen = new Map();
  for (const { t, name } of firings()) {
    const key = `${name}@${new Date(t).getUTCHours() * 60 + new Date(t).getUTCMinutes()}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries([...seen].sort()), Object.fromEntries([...expected].sort()));
});

test('a slot off the five-minute grid goes out on the next tick and no other', () => {
  const at = (h, m) => dueTargets(Date.UTC(2026, 10, 10, h, m)).map(nameOf);
  assert.ok(at(7, 15).includes('affiliate-status.yml'), 'the 07:11 slot belongs to the 07:15 tick');
  assert.ok(!at(7, 20).includes('affiliate-status.yml'));
  assert.ok(!at(7, 10).includes('affiliate-status.yml'));
});

test('a tick that arrives a little off the grid still owes the same slots', () => {
  const on = dueTargets(Date.UTC(2026, 10, 10, 7, 35));
  const off = dueTargets(Date.UTC(2026, 10, 10, 7, 35, 2, 500));
  assert.deepEqual(off, on);
  assert.ok(on.map(nameOf).includes('publish-watchdog.yml'));
});

test('slots carry their inputs: weekly work must not run on a daily slot', () => {
  const refresh = (ms) => dueTargets(ms).find((t) => nameOf(t) === 'refresh.yml');
  assert.deepEqual(refresh(Date.UTC(2026, 10, 10, 19, 35)).inputs, { full: 'false' }); // Tuesday
  assert.deepEqual(refresh(Date.UTC(2026, 10, 15, 20, 35)).inputs, { full: 'true' }); // Sunday
  const live = (ms) => dueTargets(ms).find((t) => nameOf(t) === 'live-checks.yml');
  assert.deepEqual(live(Date.UTC(2026, 10, 10, 11, 45)).inputs, { pass_warnings: 'false' });
  assert.deepEqual(live(Date.UTC(2026, 10, 10, 13, 20)).inputs, { pass_warnings: 'true' });
});

test('a workflow never has two clocks unless it can stand down', () => {
  for (const w of alarmOnly) {
    const src = readFileSync(here('../../.github/workflows/' + w.file), 'utf8');
    assert.doesNotMatch(src, /^\s+- cron:/m, `${w.file} is alarmOnly but still has a GitHub cron: it would run twice`);
  }
});

test('everything the alarm wakes can be woken, with the inputs it is sent', () => {
  for (const target of Object.values(SCHEDULE).flat()) {
    const src = readFileSync(here('../../.github/workflows/' + nameOf(target)), 'utf8');
    assert.match(src, /^\s+workflow_dispatch:/m, `${nameOf(target)} has no workflow_dispatch`);
    for (const key of Object.keys(target.inputs ?? {})) {
      assert.match(src, new RegExp(`^\\s+${key}:`, 'm'), `${nameOf(target)} does not declare input ${key}`);
    }
  }
});

test('publish itself is never in the table: only its watchdog may start it', () => {
  assert.ok(!Object.values(SCHEDULE).flat().map(nameOf).includes('publish.yml'));
});

test('the manual test endpoint cannot start the whole table', () => {
  assert.deepEqual(SMOKE_TARGETS, ['threads-daily.yml', 'publish-watchdog.yml', 'schedule-watchdog.yml']);
});

test('the account cron budget is not overspent', () => {
  // Cloudflare free plan: 5 cron triggers per ACCOUNT, and this is the only
  // worker on it with any. Verified against the platform limits page 2026-08-31.
  assert.ok(wrangler.triggers.crons.length <= 5, 'more crons than the free plan allows per account');
});

test('a workflow that keeps its GitHub cron is woken just after it', () => {
  const only = new Set(alarmOnly.map((w) => w.file));
  for (const [cron, targets] of Object.entries(SCHEDULE)) {
    for (const wf of targets.map(nameOf).filter((n) => !only.has(n))) {
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
