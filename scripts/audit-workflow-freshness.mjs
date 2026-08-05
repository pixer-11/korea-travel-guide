#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  WORKFLOW FRESHNESS — has each scheduled job actually run lately?
//
//  audit-automation.mjs reads the workflow FILES; this asks GitHub what really
//  happened. A workflow can be valid, wired to Telegram, listed in the failure
//  watcher — and simply stop running. GitHub disables schedules on repos it
//  considers inactive, a cron can be edited into a slot that never fires, and a
//  workflow whose last run failed at the setup step never gets far enough to
//  report anything. In all three cases the owner's evidence is silence, which
//  is indistinguishable from a quiet, healthy night.
//
//  Every defect chased on 2026-08-05 had this shape: something had been not
//  working for weeks and the only signal was the absence of bad news.
//
//  Run inside Actions, where GITHUB_TOKEN lifts the API rate limit (the
//  unauthenticated 60/hour is spent almost immediately by a repo this size).
//
//   GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo node scripts/audit-workflow-freshness.mjs
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const WF_DIR = process.argv[2] || '.github/workflows';
const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

// Rough expected gap for a cron, in days. Only the coarse shape matters: the
// question is "has this run at all recently", not "was it punctual".
function expectedGapDays(cron) {
  const [, , dom, , dow] = cron.trim().split(/\s+/);
  if (dow && dow !== '*') return 7;          // weekly
  if (dom && dom !== '*') return 31;         // monthly
  return 1;                                  // daily or more often
}

const workflows = [];
for (const f of readdirSync(WF_DIR).filter((x) => /\.ya?ml$/.test(x))) {
  const src = readFileSync(join(WF_DIR, f), 'utf8');
  const name = (src.match(/^name:\s*(.+)$/m) || [])[1]?.trim().replace(/^['"]|['"]$/g, '') || f;
  const crons = [...src.matchAll(/- cron:\s*'([^']+)'/g)].map((m) => m[1]);
  if (!crons.length) continue;               // event-driven jobs are not "late"
  workflows.push({ f, name, gap: Math.min(...crons.map(expectedGapDays)) });
}

if (!REPO || !TOKEN) {
  console.log(`ℹ️  ${workflows.length} scheduled workflow(s) found; set GITHUB_REPOSITORY and GITHUB_TOKEN to check their run history.`);
  process.exit(0);
}

const res = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?per_page=100`, {
  headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' },
});
if (!res.ok) {
  console.log(`⚠️  could not read run history (${res.status}) — not treating that as a defect`);
  process.exit(0);
}
const runs = (await res.json()).workflow_runs || [];
const lastRun = new Map();
for (const r of runs) if (!lastRun.has(r.name)) lastRun.set(r.name, r);

const now = Date.now();
const late = [];
for (const w of workflows) {
  const r = lastRun.get(w.name);
  // Absent from the last 100 runs is only meaningful for frequent jobs; a
  // monthly one can legitimately fall off a busy repo's recent list.
  if (!r) { if (w.gap <= 7) late.push({ ...w, days: null }); continue; }
  const days = (now - new Date(r.created_at)) / 864e5;
  // Three missed cycles, not one: a skipped night is normal (runner queues,
  // concurrency groups), three in a row is a job that has stopped.
  if (days > w.gap * 3) late.push({ ...w, days });
}

for (const l of late) {
  console.log(l.days == null
    ? `  ⏰ ${l.name} — expected every ~${l.gap}d, no run in the last 100`
    : `  ⏰ ${l.name} — expected every ~${l.gap}d, last ran ${l.days.toFixed(1)}d ago`);
}
console.log(`\n📆 ${workflows.length} scheduled workflow(s): ${late.length} overdue`);
console.log(`WORKFLOW_FRESHNESS_SUMMARY scheduled=${workflows.length} overdue=${late.length}`);
process.exit(late.length ? 1 : 0);
