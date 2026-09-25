#!/usr/bin/env node
// Korean one-liners from the Claude cost ledger, for the Telegram reports.
//
//   node scripts/claude-cost-report.mjs --run <GITHUB_RUN_ID>
//     → this run's spend, then yesterday's (KST) total over all automated jobs
//       (every Claude-calling workflow keeps the ledger). Add --attempt for a re-run.
//   node scripts/claude-cost-report.mjs --day 2026-09-25
//     → that KST day's total
//
// Prints nothing when there is nothing to say, so a caller can append the
// output to a message unconditionally. The ledger is written by
// scripts/lib/claude-meter.mjs; prices live in scripts/lib/claude-cost.mjs.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { costLine, kstDay, sumRows } from './lib/claude-cost.mjs';

const LEDGER = process.env.CLAUDE_COST_LEDGER
  || fileURLToPath(new URL('../data/claude-cost.jsonl', import.meta.url));

export function readLedger(path = LEDGER) {
  if (!existsSync(path)) return [];
  const rows = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a torn line is skipped, not fatal */ }
  }
  return rows;
}

export function report(rows, { run, attempt, day } = {}) {
  const lines = [];
  if (run) {
    // A re-run keeps its run id, so the attempt has to match too (rows written
    // before attempts were recorded count as attempt 1).
    const a = String(attempt || '1');
    const mine = rows.filter((r) => String(r.run) === String(run) && String(r.attempt || '1') === a);
    const l = costLine(sumRows(mine), '💸 이번 작업 Claude 비용');
    if (l) lines.push(l);
    // Yesterday is the last day that is over, so its line is the automation's
    // real daily spend: every workflow that calls Claude keeps this ledger. Scripts
    // run by hand (no CLAUDE_COST_LEDGER) are not in it, hence "자동 작업"
    // (claude-cost.test.mjs fails the build when one does not).
    const y = kstDay(new Date(Date.now() - 86400e3));
    const all = sumRows(rows.filter((r) => r.day === y));
    if (all.calls) lines.push(costLine(all, `📅 어제(${y.slice(5)}) 자동 작업 전체 Claude 비용`));
  } else {
    const d = day || kstDay();
    const l = costLine(sumRows(rows.filter((r) => r.day === d)), `💸 ${d.slice(5)} Claude 비용`);
    if (l) lines.push(l);
  }
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const out = report(readLedger(), { run: arg('--run'), attempt: arg('--attempt'), day: arg('--day') });
  if (out) console.log(out);
}
