// The manifest is a copy of facts that live in the workflow files, and a copy
// drifts. Two consumers trust it — schedule-watchdog (to decide a slot was
// missed) and slot-served (to decide a slot was already served) — so a stale
// cron here makes both lie in the same direction, silently, on a schedule.
// The cross-check was written down as "추가 예정" on 2026-08-28 and left undone
// for three days; this is it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MANIFEST } from './cron-manifest.mjs';

const WF = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));
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
