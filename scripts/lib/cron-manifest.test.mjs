// The manifest is a copy of facts that live in the workflow files, and a copy
// drifts. Two consumers trust it — schedule-watchdog (to decide a slot was
// missed) and slot-served (to decide a slot was already served) — so a stale
// cron here makes both lie in the same direction, silently, on a schedule.
// The cross-check was written down as "추가 예정" on 2026-08-28 and left undone
// for three days; this is it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MANIFEST, GRACE_MIN, graceFor } from './cron-manifest.mjs';
import { lastFireBefore } from './cron-window.mjs';

const WF = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));
const SCRIPTS = fileURLToPath(new URL('../', import.meta.url));
const cronsIn = (file) =>
  [...readFileSync(WF + file, 'utf8').matchAll(/^\s*-\s*cron:\s*'([^']+)'/gm)].map((m) => m[1]);

test('every manifest entry names a workflow that exists', () => {
  for (const w of MANIFEST) {
    assert.ok(existsSync(WF + w.file), `${w.file} is in the manifest but not in .github/workflows`);
  }
});

test('manifest crons match the workflow files exactly', () => {
  for (const w of MANIFEST) {
    const real = cronsIn(w.file);
    // The Cloudflare alarm is this entry's only clock (workers/social-alarm).
    if (w.alarmOnly) {
      assert.deepEqual(real, [], `${w.file} is alarmOnly but still has a GitHub cron`);
      continue;
    }
    assert.deepEqual(
      [...w.crons].sort(),
      [...real].sort(),
      `${w.file}: the manifest says ${JSON.stringify(w.crons)} but the workflow runs ${JSON.stringify(real)} — ` +
        'the watchdog would judge the wrong slot and the slot guard would open the wrong window',
    );
  }
});

test('inputsByCron keys are crons the entry actually lists', () => {
  for (const w of MANIFEST) {
    for (const key of Object.keys(w.inputsByCron ?? {})) {
      assert.ok(
        w.crons.includes(key),
        `${w.file}: inputsByCron has "${key}", which is not one of its crons — a rescue would go out bare`,
      );
    }
  }
});

// A short grace rescues while GitHub's late original is still on its way, so
// only a workflow that stands down by itself may have one. refresh, alt-photos
// and indexnow have no slot guard: rescued early, they would simply run twice.
test('a shortened grace only goes to a workflow with a slot guard', () => {
  const sources = readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs')).map((f) => readFileSync(SCRIPTS + f, 'utf8'));
  const stands = (w) => sources.some((s) => s.includes(`exitIfSlotServed('${w.file}')`));
  const short = MANIFEST.filter((w) => graceFor(w) < GRACE_MIN);
  for (const w of short) assert.ok(stands(w), `${w.file} has a ${graceFor(w)}-minute grace and no slot guard`);
  assert.deepEqual(short.map((w) => w.file), ['analytics-report.yml']);
});

test('the rest of the roster keeps the full grace, and the morning report does not', () => {
  assert.equal(GRACE_MIN, 100);
  const report = MANIFEST.find((w) => w.file === 'analytics-report.yml');
  assert.equal(graceFor(report), 30);
  assert.equal(graceFor({ file: 'x.yml' }), GRACE_MIN);
  assert.equal(graceFor({ file: 'x.yml', graceMin: 0 }), 0);
});

// The watchdog runs on import, so its one line of judgement is read, not called.
test('the watchdog judges each entry by its own grace', () => {
  const src = readFileSync(SCRIPTS + 'schedule-watchdog.mjs', 'utf8');
  assert.match(src, /overdueMin <= graceFor\(w\)/);
  assert.doesNotMatch(src, /const GRACE_MIN/);
});

// An early rescue is the morning's routine; only a slot past the full grace is a
// dropped run worth a message. What counts is whether the phone buzzes, so this
// one is called: the real script, on a frozen clock and a fake network.
const fakeWorld = (now) => 'data:text/javascript,' + encodeURIComponent(`
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(${now}); }
    static now() { return ${now}; }
  };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('api.telegram.org')) { console.log('FAKE_ALERT'); return new Response('{"ok":true}'); }
    if (u.includes('/dispatches')) { console.log('FAKE_DISPATCH'); return new Response(null, { status: 204 }); }
    const late = u.includes('/workflows/analytics-report.yml/');
    return new Response(JSON.stringify({ workflow_runs: late ? [] : [{ status: 'completed', conclusion: 'success' }] }));
  };
`);

test('only a rescue past the full grace reaches the owner as a dropped run', () => {
  const report = MANIFEST.find((w) => w.file === 'analytics-report.yml');
  const slot = lastFireBefore(report.crons[0], Date.parse('2026-11-10T12:00:00Z'));
  const at = (overdueMin) => {
    const r = spawnSync(process.execPath, ['--import', fakeWorld(slot + overdueMin * 60000), SCRIPTS + 'schedule-watchdog.mjs'], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_TOKEN: 'x', GITHUB_REPOSITORY: 'o/r', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' },
    });
    assert.equal(r.status, 0, r.stderr);
    return { rescued: r.stdout.includes('FAKE_DISPATCH'), alerted: r.stdout.includes('FAKE_ALERT') };
  };
  assert.deepEqual(at(graceFor(report) - 1), { rescued: false, alerted: false }, 'still inside its own grace');
  assert.deepEqual(at(graceFor(report) + 1), { rescued: true, alerted: false }, 'an early rescue must stay quiet');
  assert.deepEqual(at(GRACE_MIN), { rescued: true, alerted: false }, 'the full grace itself is not yet a dropped run');
  assert.deepEqual(at(GRACE_MIN + 1), { rescued: true, alerted: true }, 'a slot past the full grace must be announced');
});

// A weekly job's "last slot" can be days old, and a failed run must not restart
// an expensive audit four times a day. Called for real, like the test above.
const weeklyWorld = (now, runs) => 'data:text/javascript,' + encodeURIComponent(`
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(${now}); }
    static now() { return ${now}; }
  };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('api.telegram.org')) return new Response('{"ok":true}');
    if (u.includes('/dispatches')) { console.log('FAKE_DISPATCH ' + u.split('/workflows/')[1]); return new Response(null, { status: 204 }); }
    const mine = u.includes('/workflows/link-check.yml/');
    return new Response(JSON.stringify({ workflow_runs: mine ? ${JSON.stringify(runs)} : [{ status: 'completed', conclusion: 'success' }] }));
  };
`);

test('a weekly job is rescued once, on its own day, and only if it never ran', () => {
  const entry = MANIFEST.find((w) => w.file === 'link-check.yml');
  const slot = lastFireBefore(entry.crons[0], Date.parse('2026-11-12T00:00:00Z'));
  const dispatched = (overdueMin, runs) => {
    const r = spawnSync(process.execPath, ['--import', weeklyWorld(slot + overdueMin * 60000, runs), SCRIPTS + 'schedule-watchdog.mjs'], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_TOKEN: 'x', GITHUB_REPOSITORY: 'o/r', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' },
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.includes('FAKE_DISPATCH link-check.yml');
  };
  assert.equal(dispatched(GRACE_MIN + 1, []), true, 'the alarm never woke it: rescue');
  assert.equal(dispatched(GRACE_MIN + 1, [{ status: 'completed', conclusion: 'failure' }]), false, 'it ran and failed: its own alert says so');
  assert.equal(dispatched(25 * 60, []), false, 'more than a day late: leave it to the next slot');
});

// Not every cron belongs in the manifest (weeklies can wait a week; the
// watchdog's own four slots cover each other). What must never happen is a
// DAILY job whose miss nobody would notice — so this test names the ones we
// have deliberately left out, and fails when a new one appears unexamined.
const KNOWN_UNGUARDED_DAILY = new Set([
  'schedule-watchdog.yml',   // four slots a day; they cover each other
  'affiliate-status.yml',    // report only, no state; a missed day costs a report
  'newsletter-report.yml',   // same
  'visual-audit.yml',        // same, plus its own commit guard
  'smoke.yml',               // alerts on its own failure
  'live-checks.yml',         // same as smoke; two slots a day cover each other, no state
]);

test('no NEW unguarded daily cron appears without a decision', () => {
  const named = new Set(MANIFEST.map((w) => w.file));
  const surprises = [];
  for (const f of readdirSync(WF).filter((f) => f.endsWith('.yml'))) {
    if (named.has(f) || KNOWN_UNGUARDED_DAILY.has(f)) continue;
    if (cronsIn(f).some((c) => /^\S+ \S+ \* \* \*$/.test(c))) surprises.push(f);
  }
  assert.deepEqual(
    surprises,
    [],
    'these run daily but nothing watches them: add to MANIFEST, or to KNOWN_UNGUARDED_DAILY with a reason',
  );
});
