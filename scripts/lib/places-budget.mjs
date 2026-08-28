// ─────────────────────────────────────────────────────────────
//  SHARED PLACES DETAILS BUDGET
//
//  Google caps Place Details at 100 calls/day for this project. Four jobs spend
//  from that one pot, and until 2026-08-05 each simply had its own limit with no
//  knowledge of the others: publish 16 + backfill-details 80 + quality-audit 15
//  = 111 on an ordinary day, before the country fill added 25-75 more. They run
//  nose-to-tail, so the last one always found the pot empty. The measured
//  casualty was closure detection: data/refresh-cursor.json held ONE entry, i.e.
//  the weekly sweep checked 1 of 536 venue posts before its first 429 and
//  stopped. Venues that have permanently closed can sit live indefinitely.
//
//  So the jobs now draw from a recorded daily ledger instead of assuming.
//
//  Shares are STATIC — an earlier comment promised "a job that finishes under
//  its share leaves the remainder for whoever runs next", and claim() never
//  implemented it (Codex audit 2026-08-28 caught the gap; the old test even
//  asserted the static behavior under a spillover name). Rather than invent a
//  carryover protocol at midnight, the shares were REBALANCED for the throttle
//  era (publish is 5 posts/day and backfill is 0, so their old shares sat
//  idle while refresh needed ~30 weeks per rotation):
//
//    publish        25   new content at 5/day uses ~10-15
//    backfill       10   throttled to zero; keep a floor for stragglers
//    refresh        50   closure detection + lastmod freshness on the pages
//                        Google still crawls — the crisis-era priority
//    quality        15   address/photo cleanup, the most deferrable
//
//  Revisit this split with the 2026-09-10 throttle verdict (see
//  data/publish-throttle.json howToDecide). Nothing here talks to Google — it
//  records intent, and the existing 429 guards remain the real backstop.
// ─────────────────────────────────────────────────────────────
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const LEDGER = fileURLToPath(new URL('../../data/places-budget.json', import.meta.url));
export const DAILY_CAP = Number(process.env.PLACES_DAILY_CAP || 100);
export const SHARES = { publish: 25, backfill: 10, refresh: 50, quality: 15 };

// ── Text Search — the SECOND pot (2026-08-23) ────────────────────────────
// The Details ledger above assumed Text Search was "75k/day, effectively
// free" (backfill.yml). It is not: on 2026-08-23 Google answered 429 for
// quota metric SearchTextRequests after ~110 searches, with this ledger
// reading 0/100 — the 16:19 publish run alone spent them (14 posts + 97
// targets whose candidates had no verifiable photo, one search each), and
// the 18:46 bulk run was refused on its first query. Same shape as Details:
// a daily cap, shares per job, the remainder handed down. `publish` is the
// scheduled 16:19 run, `fill` the bulk run that follows it.
export const SEARCH_DAILY_CAP = Number(process.env.PLACES_SEARCH_DAILY_CAP || 100);
export const SEARCH_SHARES = { publish: 55, fill: 35, other: 10 };

const today = () => new Date().toISOString().slice(0, 10);

async function load() {
  try {
    const j = JSON.parse(await readFile(LEDGER, 'utf8'));
    if (j.date === today()) { j.search ||= { spent: 0, byJob: {} }; return j; }
  } catch { /* first run, or a new day */ }
  return { date: today(), spent: 0, byJob: {}, search: { spent: 0, byJob: {} } };
}

/** How many Text Search calls `job` may make right now (same rules as claim()). */
export async function claimSearch(job) {
  const share = SEARCH_SHARES[job] ?? SEARCH_SHARES.other;
  const led = await load();
  const remainingToday = Math.max(0, SEARCH_DAILY_CAP - led.search.spent);
  const alreadyMine = led.search.byJob[job] || 0;
  const allowance = Math.max(0, Math.min(share - alreadyMine, remainingToday));
  return { allowance, spentToday: led.search.spent, remainingToday };
}

/** Record the Text Search calls a job actually made. */
export async function recordSearch(job, used) {
  if (!Number.isFinite(used) || used <= 0) return;
  const led = await load();
  led.search.spent += used;
  led.search.byJob[job] = (led.search.byJob[job] || 0) + used;
  led.updated = new Date().toISOString();
  await writeFile(LEDGER, JSON.stringify(led, null, 1) + '\n', 'utf8');
}

export function describeSearch(job, { allowance, spentToday }) {
  return `Places 검색 예산: ${job} 몫 ${allowance}회 (오늘 사용 ${spentToday}/${SEARCH_DAILY_CAP})`;
}

/**
 * How many Details calls `job` may make right now: its own share, capped by
 * the day's remaining total. (No carryover between jobs — see the header.)
 * Returns 0 when the pot is dry, which callers should treat as "do nothing
 * today", not as an error.
 */
export async function claim(job) {
  const share = SHARES[job];
  if (!share) throw new Error(`unknown Places job "${job}" — add it to SHARES`);
  const led = await load();
  const remainingToday = Math.max(0, DAILY_CAP - led.spent);
  const alreadyMine = led.byJob[job] || 0;
  const allowance = Math.max(0, Math.min(share - alreadyMine, remainingToday));
  return { allowance, spentToday: led.spent, remainingToday };
}

/** Record what a job actually used, so the next job in the chain sees it. */
export async function record(job, used) {
  if (!Number.isFinite(used) || used <= 0) return;
  const led = await load();
  led.spent += used;
  led.byJob[job] = (led.byJob[job] || 0) + used;
  led.updated = new Date().toISOString();
  await writeFile(LEDGER, JSON.stringify(led, null, 1) + '\n', 'utf8');
}

/** Human-readable one-liner for the Telegram reports. */
export function describe(job, { allowance, spentToday }) {
  return `Places 예산: ${job} 몫 ${allowance}회 (오늘 사용 ${spentToday}/${DAILY_CAP})`;
}
