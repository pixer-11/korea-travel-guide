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
  // Anchored to the line start so a COMMENTED-OUT cron is not counted. A
  // schedule that was deliberately switched off still leaves its line in the
  // file, prefixed with '#', because the reason is written next to it — and the
  // old pattern matched the "- cron: '…'" inside that comment. attach-placeless
  // had its crons disabled on 2026-07-26 (Google photo billing is blocked for
  // this account, so the runs only burned the quota the morning publish needs),
  // and this audit reported it every day since as "expected every ~1d, no run
  // in the last 100" — 17 days of an alarm for a job doing exactly what it was
  // told. A false overdue is worse than none: it teaches you to skim the list.
  const crons = [...src.matchAll(/^\s*- cron:\s*'([^']+)'/gm)].map((m) => m[1]);
  if (!crons.length) continue;               // event-driven or disabled — not "late"
  workflows.push({ f, name, gap: Math.min(...crons.map(expectedGapDays)) });
}

if (!REPO || !TOKEN) {
  console.log(`ℹ️  ${workflows.length} scheduled workflow(s) found; set GITHUB_REPOSITORY and GITHUB_TOKEN to check their run history.`);
  process.exit(0);
}

// Ask each workflow for ITS own last run, rather than slicing one shared
// "recent 100" list. On a repo this busy the shared list covers only a few
// hours — on 2026-08-11 it held nothing but that morning's runs, so six weekly
// jobs that had all run normally 2-7 days earlier were reported as overdue.
// One request per workflow file is a handful of calls and the answer is exact.
const head = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' };
const lastRun = new Map();
let apiFailed = false;
for (const w of workflows) {
  // The file name is the workflow's stable id in this endpoint — its `name:`
  // can change without warning, and matching on that is how a renamed job
  // silently becomes "never ran".
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${encodeURIComponent(w.f)}/runs?per_page=1`,
    { headers: head },
  ).catch(() => null);
  if (!r || !r.ok) { apiFailed = true; continue; }
  const run = ((await r.json()).workflow_runs || [])[0];
  if (run) lastRun.set(w.name, run);
}
if (apiFailed && !lastRun.size) {
  console.log('⚠️  could not read run history — not treating that as a defect');
  process.exit(0);
}

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
