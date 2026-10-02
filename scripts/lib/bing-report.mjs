// The daily report's Bing block.
//
// What was wrong with the old block (measured 2026-10-02, against the report
// for 10-01):
//   · it was sent as "today's" Bing numbers, but GetQueryStats is five WEEKLY
//     bundles summed since Bing began recording (08-26). A new bundle arrives
//     once a week, so seven reports in a row carried the same figures;
//   · its "top" line ranked rows from all five weeks, so a query that had not
//     been searched since 09-10 (a concert on 09-12) led the list for 3 weeks;
//   · its language CTRs were cumulative ratios over tiny denominators, and one
//     week of leaked zero-click rows read as "Chinese fell from 25% to 17%"
//     while Chinese clicks had gone up (41 → 48 a week);
//   · "CTR 10.1%" is the rate inside the list Bing publishes (the top ~100
//     queries a week, mostly ones that were clicked) — the site's own rate over
//     the same days was 1.1%.
//
// So: lead with the one Bing number that moves every day (daily clicks, from
// GetRankAndTrafficStats), say how old everything is, compare weeks by clicks
// rather than ratios, and take "top" from the newest week only.
import { bingSplit, queryLang } from './bing-dead-queries.mjs';

const DAY = 86_400_000;

/** Bing's `/Date(1787875200000)/` (sometimes with a `-0700` tail) → epoch ms, or null. */
export function bingDate(row) {
  const m = /\/Date\((\d+)/.exec(String(row?.Date ?? ''));
  return m ? Number(m[1]) : null;
}
const md = (ms) => new Date(ms).toISOString().slice(5, 10);
const pct = (now, was) => (was > 0 ? ` (${now >= was ? '+' : ''}${Math.round(((now - was) / was) * 100)}%)` : '');
const sum = (rows, k) => rows.reduce((s, r) => s + (r?.[k] ?? 0), 0);

/**
 * The last seven recorded days against the seven before them.
 * @returns {{to:number, last:{clicks:number,imp:number}, prev:{clicks:number,imp:number}|null}|null}
 */
export function bingDaily(dailyRows) {
  const rows = (Array.isArray(dailyRows) ? dailyRows : [])
    .map((r) => ({ t: bingDate(r), Clicks: r?.Clicks ?? 0, Impressions: r?.Impressions ?? 0 }))
    .filter((r) => r.t !== null)
    .sort((a, b) => a.t - b.t);
  if (rows.length < 7) return null;
  const last = rows.slice(-7);
  const prev = rows.length >= 14 ? rows.slice(-14, -7) : null;
  const tot = (a) => ({ clicks: sum(a, 'Clicks'), imp: sum(a, 'Impressions') });
  return { to: last[last.length - 1].t, last: tot(last), prev: prev ? tot(prev) : null };
}

/**
 * @param {object[]} queryRows  GetQueryStats rows (one per query per week)
 * @param {object[]|null} dailyRows  GetRankAndTrafficStats rows, or null when that call failed
 * @returns {string[]} report lines; empty when there are no query rows
 */
export function bingLines(queryRows, dailyRows) {
  const rows = Array.isArray(queryRows) ? queryRows : [];
  if (!rows.length) return [];
  const split = bingSplit(rows);
  const L = ['🅱️ 빙 검색'];

  const daily = bingDaily(dailyRows);
  if (daily) {
    const was = daily.prev ? ` · 직전 7일 ${daily.prev.clicks}${pct(daily.last.clicks, daily.prev.clicks)}` : '';
    L.push(`   └ 일별 총계(${md(daily.to)}까지 — 빙 집계는 3~4일 늦습니다): 최근 7일 클릭 ${daily.last.clicks}${was}`);
  }

  // A bundle labelled D covers D-7 … D-1 (checked against per-query daily
  // figures, 10-02). Rows without a date are kept, just not placed in a week.
  const labels = [...new Set(rows.map(bingDate).filter((t) => t !== null))].sort((a, b) => a - b);
  const latest = labels[labels.length - 1] ?? null;
  const before = labels[labels.length - 2] ?? null;
  const span = (label) => `${md(label - 7 * DAY)}~${md(label - DAY)}`;
  const upTo = latest === null ? '' : ` · ${md(latest - DAY)}까지 누적`;

  L.push(`   └ 검색어 목록(주 1회 갱신${upTo}): 실질 노출 ${split.live.imp.toLocaleString()} · 클릭 ${split.live.clicks}`
    + ` — 목록 안 CTR ${(split.live.ctr * 100).toFixed(1)}% (빙이 공개하는 검색어만의 비율, 사이트 전체 CTR 아님)`);
  if (split.dead.n) {
    L.push(`   └ ⚠️ 크게 노출되고 한 번도 안 눌린 검색어 ${split.dead.queries}개(노출 ${split.dead.imp.toLocaleString()})는 뺀 수치입니다 — 누를 뜻이 없는 노출로 봅니다`);
  }

  const inWeek = (label) => (label === null ? split.liveRows : split.liveRows.filter((r) => bingDate(r) === label));
  const now = inWeek(latest);
  const was = before === null ? [] : inWeek(before);
  const clicksByLang = (list) => {
    const m = new Map();
    for (const r of list) m.set(queryLang(r.Query), (m.get(queryLang(r.Query)) ?? 0) + (r.Clicks ?? 0));
    return m;
  };
  const a = clicksByLang(now), b = clicksByLang(was);
  const langs = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => (a.get(y) ?? 0) - (a.get(x) ?? 0));
  if (langs.length) {
    const head = latest === null ? '언어별 클릭' : `언어별 클릭 — 최신 주(${span(latest)})${before === null ? '' : ' · 괄호는 직전 주'}`;
    L.push(`   └ ${head}: ${langs.map((k) => `${k} ${a.get(k) ?? 0}${before === null ? '' : `(${b.get(k) ?? 0})`}`).join(' · ')}`);
  }

  const pageOne = now.filter((x) => (x.AvgImpressionPosition ?? 99) <= 5);
  L.push(`   └ ${latest === null ? '' : '최신 주 '}5위 안 검색어 ${pageOne.length}개(노출 ${sum(pageOne, 'Impressions').toLocaleString()})`);

  // By clicks, not impressions: ranked by impressions this line was three
  // queries nobody clicked (10-02 preview: 245, 111 and 89 impressions, 0 clicks).
  const top = now
    .filter((x) => (x.Clicks ?? 0) > 0)
    .sort((x, y) => (y.Clicks ?? 0) - (x.Clicks ?? 0) || (y.Impressions ?? 0) - (x.Impressions ?? 0))
    .slice(0, 3)
    .map((x) => `${String(x.Query).slice(0, 24)} 클릭 ${x.Clicks}·노출 ${x.Impressions}·${Math.round(x.AvgImpressionPosition ?? 0)}위`);
  if (top.length) L.push(`   └ ${latest === null ? '' : '최신 주 '}클릭 상위: ${top.join(' · ')}`);
  return L;
}
