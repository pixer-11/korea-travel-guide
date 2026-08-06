import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// HOW LONG has this problem been reported?
//
// Every defect found on 2026-08-06 had the same shape: a checker had been
// naming it correctly, every day, and nothing happened.
//
//   UNVERIFIED-PHOTO   11 posts, reported daily for up to 14 days
//   DUPLICATE event    the same pair flagged every run since 08-05
//   broken links       ~2,000 a week, all false, so the report was ignored
//   astro check        113 errors — the command was never run at all
//   WEAK hero verdict  counted by the vision gate, acted on by nobody
//
// Each was then fixed one at a time, and each fix risked breaking something
// else. The common cause is not any of those checkers: it is that a finding
// and a NEW finding look identical in a daily report, so "still broken since
// Tuesday" reads exactly like "just appeared". A number that never improves
// stops being read.
//
// The ledger gives every finding an age. Anything that survives more than a
// few days is escalated by name, and anything that disappears is forgotten —
// so the report can say "3 new, 1 unresolved for 6 days" instead of "4".

const LEDGER = 'data/issue-ledger.json';
const ESCALATE_AFTER_DAYS = 3;

const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

function load() {
  if (!existsSync(LEDGER)) return {};
  try { return JSON.parse(readFileSync(LEDGER, 'utf8')); } catch { return {}; }
}

/**
 * Record the CURRENT set of open findings for one checker and return what has
 * been open too long.
 *
 * @param {string} source  checker name, e.g. 'validate-content'
 * @param {string[]} keys  stable identifiers for what is open right now
 * @param {{ write?: boolean, day?: string }} [opts]
 * @returns {{ fresh: string[], stale: {key: string, days: number, since: string}[], resolved: string[] }}
 */
export function trackIssues(source, keys, opts = {}) {
  const day = opts.day ?? today();
  const write = opts.write !== false;
  const ledger = load();
  const prev = ledger[source] ?? {};
  const now = {};
  const fresh = [];
  const stale = [];

  for (const key of new Set(keys)) {
    const before = prev[key];
    const since = before?.since ?? day;
    // seen is a COUNT of days observed, not of runs: a checker that runs three
    // times an hour must not age its findings three times as fast.
    const seen = before && before.last === day ? before.seen : (before?.seen ?? 0) + 1;
    now[key] = { since, last: day, seen };
    if (!before) fresh.push(key);
    else {
      const age = daysBetween(since, day);
      if (age >= ESCALATE_AFTER_DAYS) stale.push({ key, days: age, since });
    }
  }

  const resolved = Object.keys(prev).filter((k) => !(k in now));
  ledger[source] = now;
  if (write) writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n', 'utf8');

  stale.sort((a, b) => b.days - a.days);
  return { fresh, stale, resolved };
}

/** One line for a Telegram report, or '' when there is nothing to escalate. */
export function escalationLine(source, stale) {
  if (!stale.length) return '';
  const worst = stale[0];
  const rest = stale.length > 1 ? ` 외 ${stale.length - 1}건` : '';
  return `🔴 ${source}: ${worst.days}일째 미해결 — ${worst.key}${rest}`;
}
