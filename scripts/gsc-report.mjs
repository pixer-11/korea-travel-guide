#!/usr/bin/env node
// GOOGLE SEARCH CONSOLE → Telegram (Korean).
// The site had no query-level feedback loop: Plausible shows traffic that already
// arrived, but only GSC shows what ALMOST ranked. This pulls the last 7 days and
// surfaces the highest-leverage list for a young site — "near-miss" queries sitting
// on page 2 (position 11-20) with real impressions, i.e. pages one tweak away from
// page 1 — plus the week's totals and top queries/pages.
//
// Auth, the GSC query call and the Telegram post live in lib/gsc.mjs — shared with
// audit-impression-cohort.mjs so the two can't drift.
//
// 2026-09-07: this run also refreshes data/gsc-page-performance.json, the
// per-slug earnings ledger scripts/backfill-photos-alt.mjs reads to decide
// which quarantined draft gets tonight's photo-search attempt first (see that
// file's header). The Telegram report is the deliverable that must never be
// lost, so the ledger write is best-effort and wrapped separately — a failed
// write logs and moves on, it never skips or reshapes the report below.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { getAccessToken, query, telegram, day, serviceAccount } from './lib/gsc.mjs';
import { bingWeekLine, bingQuotaLine } from './lib/bing.mjs';
import { makeNavigationalTest, guidePlaces } from './lib/navigational.mjs';

const LEDGER_PATH = 'data/gsc-page-performance.json';

// Match https://wanderatlasguides.com/{,ko/,ja/,es/,zh/}posts/<slug>/ and sum
// clicks/impressions per slug across languages, keeping the best (lowest)
// position rounded to one decimal — the same aggregation used to build the
// first hand-measured version of this file on 2026-09-07.
const PAGE_RE = /^https:\/\/wanderatlasguides\.com\/(?:ko|ja|es|zh)?\/?posts\/([^/]+)\/?$/;

function aggregateBySlug(rows) {
  const bySlug = {};
  for (const r of rows ?? []) {
    const url = r.keys?.[0];
    const m = url && url.match(PAGE_RE);
    if (!m) continue;
    const slug = m[1];
    bySlug[slug] ??= { clicks: 0, impressions: 0, position: null };
    const entry = bySlug[slug];
    entry.clicks += r.clicks ?? 0;
    entry.impressions += r.impressions ?? 0;
    if (r.position != null && (entry.position == null || r.position < entry.position)) {
      entry.position = r.position;
    }
  }
  for (const entry of Object.values(bySlug)) {
    if (entry.position != null) entry.position = Math.round(entry.position * 10) / 10;
  }
  return bySlug;
}

async function refreshPagePerformanceLedger(token, siteUrl) {
  // Independent window from the 7-day report above: clicks on a young site
  // are sparse (17 total site-wide over four weeks, per the 2026-09-07
  // measurement that motivated this file), so the ledger asks for a full
  // 4 weeks ending 2 days ago rather than the report's 7-day window — the
  // same span the first hand-built version of this ledger used.
  const endDate = day(-2), startDate = day(-30);
  try {
    const allPages = await query(token, siteUrl, { startDate, endDate, dimensions: ['page'], rowLimit: 25000 });
    const pages = aggregateBySlug(allPages.rows);
    const ledger = {
      measured: day(0),
      window: { start: startDate, end: endDate },
      note: 'Per-slug Search Console performance, languages summed. Written by scripts/gsc-report.mjs on its daily run; consumed by scripts/backfill-photos-alt.mjs to serve the photo queue in earnings order.',
      pages,
    };
    writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 1) + '\n');
  } catch (e) {
    // A ledger is not worth losing the daily report over — log and move on.
    console.error(`gsc-page-performance.json refresh failed: ${e.message.slice(0, 300)}`);
  }
}


async function main() {
  const sa = serviceAccount();
  if (!sa) return;
  const GSC_SITE_URL = process.env.GSC_SITE_URL;

  // GSC data lags ~2 days; ask for the 7 days ending 2 days ago.
  // Seven days inclusive: day(-9)..day(-2) was eight (Codex, 2026-10-05).
  const endDate = day(-2), startDate = day(-8);

  let token, totals, queries, pages;
  try {
    token = await getAccessToken(sa);
    [totals, queries, pages] = await Promise.all([
      query(token, GSC_SITE_URL, { startDate, endDate, dimensions: [] }),
      query(token, GSC_SITE_URL, { startDate, endDate, dimensions: ['query'], rowLimit: 200 }),
      // All pages, sorted here by impressions: the API orders by clicks, so a
      // week of zero clicks listed /about/ and /contact/ as "top" (2026-09-28).
      query(token, GSC_SITE_URL, { startDate, endDate, dimensions: ['page'], rowLimit: 1000 }),
    ]);
  } catch (e) {
    await telegram(`🔎 Wander Atlas — 검색 리포트 오류\n${e.message.slice(0, 300)}`);
    return;
  }

  // Best-effort, self-contained (own try/catch) — never allowed to affect
  // the report below, which is the actual deliverable of this run.
  await refreshPagePerformanceLedger(token, GSC_SITE_URL);

  const t = totals.rows?.[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const rows = queries.rows ?? [];

  // The actionable list: page-2 queries with real demand.
  const nearMiss = rows
    .filter((r) => r.position > 10 && r.position <= 20 && r.impressions >= 5)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 8);

  // Already on page 1 and still unclicked: the one place a title or snippet
  // can move clicks (see the closed retitle experiment — titles are a lever
  // only for pages that are already seen). On 2026-09-28 the Japanese Gyeongju
  // page sat at 1-5 for "慶州 観光" with ~50 impressions and no click, while
  // this report said "nothing yet" because it only looked at positions 11-20.
  const seenUnclicked = rows
    .filter((r) => r.position <= 10 && r.impressions >= 5 && r.clicks === 0)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 6);

  const topQ = rows.slice().sort((a, b) => b.clicks - a.clicks).filter((r) => r.clicks > 0).slice(0, 5);
  const shortPage = (u) => decodeURIComponent(String(u).replace(/^https?:\/\/[^/]+/, '')).slice(0, 48) || '/';

  const lines = [
    `🔎 Wander Atlas — 검색 리포트 (${startDate} ~ ${endDate})`,
    `🇬 구글: 👆 클릭 ${t.clicks} · 👀 노출 ${t.impressions} · CTR ${(t.ctr * 100).toFixed(1)}% · 평균순위 ${t.position.toFixed(1)}위`,
    // Bing, same window: Google read 0 clicks while Bing gave 228 the same
    // week (2026-10-04) and the report only ever showed Google.
    await bingWeekLine(process.env.BING_API_KEY),
    await bingQuotaLine(process.env.BING_API_KEY),
  ].filter(Boolean);

  if (topQ.length) {
    lines.push('', '🏆 클릭 많은 검색어:');
    for (const r of topQ) lines.push(`  • ${r.keys[0]} — 클릭 ${r.clicks} (${r.position.toFixed(1)}위)`);
  }

  if (nearMiss.length) {
    lines.push('', '🎯 조금만 손보면 1페이지 갈 검색어 (2페이지에 있음):');
    for (const r of nearMiss) lines.push(`  • ${r.keys[0]} — ${r.position.toFixed(1)}위, 노출 ${r.impressions}`);
    lines.push('  → 이 주제의 글 제목·본문을 보강하면 1페이지 진입 가능');
  } else {
    lines.push('', '🎯 2페이지권 검색어: 없음 (11~20위에 노출 5회 이상인 검색어가 없다)');
  }

  // A query that is just a business's name (plus "reviews", "location"...) is
  // someone looking for its map pin or own page: no click on a guide is normal
  // and no title fixes it (lib/navigational.mjs). Listed apart, so the advice
  // under the first list only covers queries a title could answer.
  let isNav = () => false;
  try {
    const common = JSON.parse(readFileSync('data/common-words.json', 'utf8')).words;
    isNav = makeNavigationalTest(guidePlaces('src/content/posts'), common);
  } catch (e) { console.error(`navigational test unavailable: ${e.message}`); }
  const answerable = seenUnclicked.filter((r) => !isNav(r.keys[0]));
  const byName = seenUnclicked.filter((r) => isNav(r.keys[0]));
  if (answerable.length) {
    lines.push('', '👀 1페이지에 보이는데 아무도 안 누른 검색어:');
    for (const r of answerable) lines.push(`  • ${r.keys[0]} — ${r.position.toFixed(1)}위, 노출 ${r.impressions}, 클릭 0`);
    lines.push('  → 검색 결과에 뜨는 제목·설명이 이 검색어에 답하지 않는 경우가 많다');
  }
  if (byName.length) {
    lines.push('', '🏷️ 1페이지·클릭 0이지만 가게 이름 검색 (지도·공식 페이지를 찾는 검색이라 정상, 제목으로 못 고친다):');
    for (const r of byName) lines.push(`  • ${r.keys[0]} — ${r.position.toFixed(1)}위, 노출 ${r.impressions}`);
  }

  const topPages = (pages.rows ?? []).slice().sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
  if (topPages.length) {
    lines.push('', '📄 노출 상위 페이지:');
    for (const r of topPages.slice(0, 5)) lines.push(`  • ${shortPage(r.keys[0])} — 클릭 ${r.clicks}, 노출 ${r.impressions}`);
  }

  // Telegram refuses a message over 4,096 characters and the whole report is
  // lost (Codex, 2026-10-05): long query lines are clipped and the list is
  // cut at a line boundary, saying so.
  let text = lines.map((l) => (l.length > 300 ? `${l.slice(0, 297)}…` : l)).join('\n');
  if (text.length > 3900) text = `${text.slice(0, text.lastIndexOf('\n', 3850))}\n…(길어서 줄임)`;
  console.log(text);
  await telegram(text);
}

// A report that failed to send must fail the run, not end green.
main().catch((e) => { console.error(e); process.exitCode = 1; });
