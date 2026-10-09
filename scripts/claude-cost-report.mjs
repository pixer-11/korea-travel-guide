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

// The account's monthly spend limit (Anthropic console), shared with the crypto
// pipeline and hand-run scripts, which this ledger does not see.
// $400 since 2026-10-06 (owner: halve the bill); $600 since 2026-10-09 (owner
// chose to keep event discovery twice a week — the best-earning content per
// Bing click — over cutting it to fit $400; the post-cut pace is ~$550-600).
// The account's own limit may be higher; this is the budget the daily report
// warns against.
export const MONTHLY_CAP = Number(process.env.CLAUDE_MONTHLY_CAP || 600);

/**
 * Month-to-date spend and a straight-line forecast against the monthly limit.
 * Every other cost line looks one day back; the limit is monthly and hits as a
 * silent 400 on every workflow at once (08-31). On 2026-10-05 the first five
 * days of October were $134 on this ledger alone — on pace for ~$830 against
 * $800 — and nothing said so. The limit resets 00:00 UTC on the 1st, so the
 * month is the UTC month of each row's timestamp, not the KST day.
 */
export function monthLine(rows, now = new Date(), cap = MONTHLY_CAP) {
  const ym = now.toISOString().slice(0, 7);
  const sum = sumRows(rows.filter((r) => String(r.ts || '').slice(0, 7) === ym));
  if (!sum.calls) return '';
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsed = Math.max(1, (now.getTime() - start) / 86400e3);
  // Straight-line over the month until a week has passed; after that, the
  // month so far + the LAST 7 DAYS' pace for the days left. The month average
  // keeps charging for days before a cost cut: on 10-09 it said $875 because
  // Oct 1-5 ($153) predated the 10-06 cuts, while the last week ran ~$24/day.
  // A 7-day window holds both weekly discovery runs, so it is not flattered.
  let forecast = (sum.usd / elapsed) * days;
  if (elapsed >= 7) {
    const weekAgo = now.getTime() - 7 * 86400e3;
    const week = sumRows(rows.filter((r) => { const t = Date.parse(r.ts || ''); return t > weekAgo && t <= now.getTime(); }));
    forecast = sum.usd + (week.usd / 7) * (days - elapsed);
  }
  const warn = forecast > cap * 0.85 ? ' ⚠️ 한도 근접 — 콘솔 상한을 올리거나 작업을 줄일 때' : '';
  return `📆 이번 달 누적 $${sum.usd.toFixed(0)} / 한도 $${cap} · 월말 예상 $${forecast.toFixed(0)} (자동 작업 장부 기준, 크립토·수동 실행 제외)${warn}`;
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
    const m = monthLine(rows);
    if (m) lines.push(m);
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
