#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  ISSUE AGE TRACKER — runs the source-level checkers, records what each one
//  is currently reporting, and says how long each finding has been open.
//
//  Why this exists: on 2026-08-06 every defect found had already been named
//  correctly by a checker, some for two weeks. Eleven unverified photos, a
//  duplicate event pair, a translation that never got written — all reported
//  daily, all ignored, because a report that says "11 issues" every morning
//  looks the same on day one and day fourteen. Ages make the difference
//  visible, and a finding that disappears is dropped from the ledger.
//
//  Prints ISSUE_LEDGER_SUMMARY for the workflow to read, and exits 0 always:
//  this measures the other checkers, it does not gate anything.
//
//    node scripts/track-issues.mjs
//    DRY=1 node scripts/track-issues.mjs   # report only, ledger untouched
// ─────────────────────────────────────────────────────────────
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { trackIssues, escalationLine } from './lib/issue-ledger.mjs';

const DRY = process.env.DRY === '1';

// Each checker: how to run it, and how to turn its output into stable keys.
// A key must name the SAME thing tomorrow — a file path or a code+path — or
// every run looks new and nothing ever ages.
export const CHECKERS = [
  {
    name: 'validate-content',
    cmd: 'node scripts/validate-content.mjs',
    keys: (out) =>
      [...out.matchAll(/^\s*•\s*([A-Z][A-Z-]+(?:\/[a-z ]+)?|DUPLICATE [a-z ]+)[^:]*:\s*(\S+)/gm)]
        .map((m) => `${m[1].trim()} ${m[2].replace(/[,)]$/, '')}`),
  },
  {
    name: 'audit-translations',
    cmd: 'node scripts/audit-translations.mjs',
    keys: (out) => [...out.matchAll(/^\s*•\s*(\S+):\s*(\S+)/gm)].map((m) => `${m[2]} ${m[1]}`),
  },
  {
    name: 'audit-hours-claims',
    cmd: 'node scripts/audit-hours-claims.mjs',
    keys: (out) => [...out.matchAll(/^\s*•?\s*([A-Z][A-Z-]+):\s*(\S+\.md)/gm)].map((m) => `${m[1]} ${m[2]}`),
  },
];

// Importable for the parser tests: running the checkers is CLI-only, or a
// test import would spend ten minutes re-auditing the whole site.
// Compare resolved paths, not a suffix: 'track-issues.test.mjs' does not end
// with 'track-issues.mjs', but a future sibling could, and importing this
// module must never run a ten-minute audit or write the ledger.
const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (!isCli) { /* imported for its CHECKERS table */ }

const lines = [];
let totalOpen = 0, totalStale = 0, totalResolved = 0;

if (isCli) for (const c of CHECKERS) {
  let out = '';
  try {
    out = execSync(c.cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    // These checkers exit non-zero WHEN THEY FIND SOMETHING — that is a
    // result, not a crash. Only a run with no output at all is a crash, and
    // one is reported rather than silently treated as "nothing open".
    out = (e.stdout || '') + (e.stderr || '');
    if (!out.trim()) {
      lines.push(`⚠️ ${c.name}: 실행 실패 — 결과 없음`);
      continue;
    }
  }
  const keys = c.keys(out);
  const { fresh, stale, resolved } = trackIssues(c.name, keys, { write: !DRY });
  totalOpen += keys.length; totalStale += stale.length; totalResolved += resolved.length;
  if (keys.length || resolved.length) {
    lines.push(`${c.name}: 열림 ${keys.length}건 (신규 ${fresh.length} · ${ESCALATE_LABEL(stale)}) · 해결 ${resolved.length}건`);
  }
  const esc = escalationLine(c.name, stale);
  if (esc) lines.push('   ' + esc);
}

function ESCALATE_LABEL(stale) {
  return stale.length ? `3일 이상 ${stale.length}` : '묵은 것 없음';
}

if (isCli) {
  console.log('\n📋 이슈 나이 추적');
  lines.forEach((l) => console.log('  ' + l));
  if (!lines.length) console.log('  (열린 지적 없음)');
  console.log(`\nISSUE_LEDGER_SUMMARY open=${totalOpen} stale=${totalStale} resolved=${totalResolved}${DRY ? ' (DRY)' : ''}`);
}
