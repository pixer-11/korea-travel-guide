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
import { getAccessToken, query, telegram, day, serviceAccount } from './lib/gsc.mjs';

async function main() {
  const sa = serviceAccount();
  if (!sa) return;
  const GSC_SITE_URL = process.env.GSC_SITE_URL;

  // GSC data lags ~2 days; ask for the 7 days ending 2 days ago.
  const endDate = day(-2), startDate = day(-9);

  let token, totals, queries, pages;
  try {
    token = await getAccessToken(sa);
    [totals, queries, pages] = await Promise.all([
      query(token, GSC_SITE_URL, { startDate, endDate, dimensions: [] }),
      query(token, GSC_SITE_URL, { startDate, endDate, dimensions: ['query'], rowLimit: 200 }),
      query(token, GSC_SITE_URL, { startDate, endDate, dimensions: ['page'], rowLimit: 10 }),
    ]);
  } catch (e) {
    await telegram(`🔎 Wander Atlas — 검색 리포트 오류\n${e.message.slice(0, 300)}`);
    return;
  }

  const t = totals.rows?.[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const rows = queries.rows ?? [];

  // The actionable list: page-2 queries with real demand.
  const nearMiss = rows
    .filter((r) => r.position > 10 && r.position <= 20 && r.impressions >= 5)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 8);

  const topQ = rows.slice().sort((a, b) => b.clicks - a.clicks).filter((r) => r.clicks > 0).slice(0, 5);
  const shortPage = (u) => decodeURIComponent(String(u).replace(/^https?:\/\/[^/]+/, '')).slice(0, 48) || '/';

  const lines = [
    `🔎 Wander Atlas — 구글 검색 리포트 (${startDate} ~ ${endDate})`,
    `👆 클릭 ${t.clicks} · 👀 노출 ${t.impressions} · CTR ${(t.ctr * 100).toFixed(1)}% · 평균순위 ${t.position.toFixed(1)}위`,
  ];

  if (topQ.length) {
    lines.push('', '🏆 클릭 많은 검색어:');
    for (const r of topQ) lines.push(`  • ${r.keys[0]} — 클릭 ${r.clicks} (${r.position.toFixed(1)}위)`);
  }

  if (nearMiss.length) {
    lines.push('', '🎯 조금만 손보면 1페이지 갈 검색어 (2페이지에 있음):');
    for (const r of nearMiss) lines.push(`  • ${r.keys[0]} — ${r.position.toFixed(1)}위, 노출 ${r.impressions}`);
    lines.push('  → 이 주제의 글 제목·본문을 보강하면 1페이지 진입 가능');
  } else {
    lines.push('', '🎯 2페이지권 검색어: 아직 없음 (노출이 더 쌓이면 표시)');
  }

  if (pages.rows?.length) {
    lines.push('', '📄 검색 유입 상위 페이지:');
    for (const r of pages.rows.slice(0, 5)) lines.push(`  • ${shortPage(r.keys[0])} — 클릭 ${r.clicks}, 노출 ${r.impressions}`);
  }

  const text = lines.join('\n');
  console.log(text);
  await telegram(text);
}

main().catch((e) => console.error(e));
