#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  WEEKLY PERFORMANCE LOG — the data feedback loop the vault's
//  performance.md was waiting for. Pulls the last 7 days of Cloudflare Web
//  Analytics (top pages by views), appends a snapshot to
//  data/performance-log.json, and computes risers/fallers vs the previous
//  week. The Obsidian vault's /sync-blog step reads this file to fill
//  01-Projects/Wander-Atlas/performance.md — so content decisions (double
//  down / refresh / drop) become data-driven instead of gut-driven.
//  Env: CF_API_TOKEN, CF_ACCOUNT_ID (same secrets as analytics-report).
// ─────────────────────────────────────────────────────────────
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../data/performance-log.json', import.meta.url));
const { CF_API_TOKEN, CF_ACCOUNT_ID } = process.env;

const isoDay = (offset) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString();
};

async function main() {
  if (!CF_API_TOKEN || !CF_ACCOUNT_ID) { console.error('CF secrets missing — skipping.'); return; }
  const start = isoDay(-7), end = isoDay(0);
  const filter = `{ datetime_geq: "${start}", datetime_leq: "${end}" }`;
  const query = `{
    viewer { accounts(filter: { accountTag: "${CF_ACCOUNT_ID}" }) {
      totals: rumPageloadEventsAdaptiveGroups(filter: ${filter}, limit: 1) { count sum { visits } }
      pages: rumPageloadEventsAdaptiveGroups(filter: ${filter}, orderBy: [count_DESC], limit: 30) {
        count
        dimensions { requestPath }
      }
    } }
  }`;
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  const a = json.data?.viewer?.accounts?.[0];
  if (!a) { console.error('GraphQL error:', JSON.stringify(json.errors || json).slice(0, 300)); process.exit(1); }

  const snapshot = {
    week: end.slice(0, 10), // snapshot date (exclusive end of the 7-day window)
    pageviews: a.totals?.[0]?.count ?? 0,
    visits: a.totals?.[0]?.sum?.visits ?? 0,
    top: (a.pages ?? []).map((p) => ({ path: p.dimensions.requestPath, views: p.count })),
  };

  let log = [];
  try { log = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
  // Idempotent per snapshot date (re-runs replace, never duplicate).
  log = log.filter((s) => s.week !== snapshot.week);

  // Risers/fallers vs the previous snapshot — the actionable part.
  const prev = log[log.length - 1];
  if (prev) {
    const prevMap = new Map(prev.top.map((t) => [t.path, t.views]));
    snapshot.risers = snapshot.top
      .map((t) => ({ path: t.path, delta: t.views - (prevMap.get(t.path) ?? 0) }))
      .filter((t) => t.delta > 0).sort((x, y) => y.delta - x.delta).slice(0, 8);
    snapshot.fallers = prev.top
      .map((t) => ({ path: t.path, delta: (snapshot.top.find((n) => n.path === t.path)?.views ?? 0) - t.views }))
      .filter((t) => t.delta < 0).sort((x, y) => x.delta - y.delta).slice(0, 8);
  }

  log.push(snapshot);
  if (log.length > 26) log = log.slice(-26); // keep half a year
  await writeFile(OUT, JSON.stringify(log, null, 2) + '\n', 'utf8');
  console.log(`📈 performance-log: week ${snapshot.week} — ${snapshot.pageviews} views, top ${snapshot.top.length} pages, ${snapshot.risers?.length ?? 0} risers / ${snapshot.fallers?.length ?? 0} fallers`);
}

main().catch((e) => { console.error(e); process.exit(1); });
