#!/usr/bin/env node
// Weekly cohort watch: are the pages that were earning impressions still earning them?
//
// Why this exists. On 08-27 the site's impressions were found to have fallen 360/day
// (08-13) to 70/day (08-24) — a 60% loss that no report had raised, because every
// report we had looked at site totals, and the totals hid it twice over:
//   * average position IMPROVED (67 → 54) while the site was losing, since the pages
//     ranking 60-95 fell out of the sample and only the better ones were left to average;
//   * ~900 posts/week keep publishing, so new pages kept the URL count healthy.
// The one number that showed it was the cohort: of the pages earning 5+ impressions
// in the earlier week, 70% still appeared — but they earned 60% less.
//
// Reads only. Appends each run to data/impression-cohort.json so that after a few
// months the alarm thresholds can be re-cut from this site's real variance instead of
// the single observation they currently rest on (see lib/cohort.mjs).
//
//   node scripts/audit-impression-cohort.mjs          # report + Telegram if alarming
//   node scripts/audit-impression-cohort.mjs --always # Telegram even when healthy
//   node scripts/audit-impression-cohort.mjs --dry    # print only, never post, never write
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getAccessToken, query, telegram, day, serviceAccount } from './lib/gsc.mjs';
import { compareCohort, verdict } from './lib/cohort.mjs';

const LEDGER = 'data/impression-cohort.json';
const dry = process.argv.includes('--dry');
const always = process.argv.includes('--always');

const pct = (x) => (x == null ? 'n/a' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(0)}%`);
const shortPage = (u) => decodeURIComponent(String(u).replace(/^https?:\/\/[^/]+/, '')).slice(0, 46) || '/';

async function main() {
  const sa = serviceAccount();
  if (!sa) return;
  const site = process.env.GSC_SITE_URL;

  // Two adjacent 7-day windows ending at the freshest complete data (GSC lags ~2
  // days). Seven and not six: equal windows must contain the same weekdays, or a
  // weekend lands on one side and the comparison measures the calendar.
  const windows = {
    prev: { startDate: day(-16), endDate: day(-10) },
    next: { startDate: day(-9), endDate: day(-3) },
  };

  let prev, next;
  try {
    const token = await getAccessToken(sa);
    [prev, next] = await Promise.all([
      query(token, site, { ...windows.prev, dimensions: ['page'], rowLimit: 5000 }),
      query(token, site, { ...windows.next, dimensions: ['page'], rowLimit: 5000 }),
    ]);
  } catch (e) {
    await telegram(`📉 Wander Atlas — 노출 코호트 감시 오류\n${e.message.slice(0, 300)}`);
    process.exitCode = 1;
    return;
  }

  const c = compareCohort(prev.rows, next.rows);
  const v = verdict(c);

  const icon = { alarm: '🚨', watch: '⚠️', ok: '✅', insufficient: 'ℹ️' }[v.level];
  const lines = [
    `${icon} Wander Atlas — 노출 코호트 감시`,
    `기준: ${windows.prev.startDate}~${windows.prev.endDate} → 비교: ${windows.next.startDate}~${windows.next.endDate}`,
    '',
    `지난주 노출 5회 이상 받던 페이지 ${c.size}개 중`,
    `  · 이번 주에도 노출된 것: ${c.survived}개 (${c.survivalRate == null ? 'n/a' : (c.survivalRate * 100).toFixed(0) + '%'})`,
    `  · 그 페이지들의 노출 합계: ${c.before} → ${c.after} (${pct(c.delta)})`,
    '',
    `판정: ${v.reason}`,
  ];

  const bucketLines = (obj, label) => {
    const entries = Object.entries(obj)
      .filter(([, b]) => b.before >= 20) // a bucket too small to read is noise, not a finding
      .sort((a, b) => (a[1].after - a[1].before) - (b[1].after - b[1].before));
    if (!entries.length) return;
    lines.push('', `${label}:`);
    for (const [k, b] of entries.slice(0, 6)) {
      lines.push(`  · ${k}: ${b.before} → ${b.after} (${pct((b.after - b.before) / b.before)}, ${b.pages}p)`);
    }
  };
  bucketLines(c.byKind, '유형별');
  bucketLines(c.byLang, '언어별');

  if (v.level === 'alarm' || v.level === 'watch') {
    if (c.worst.length) {
      lines.push('', '가장 많이 잃은 페이지:');
      for (const w of c.worst) lines.push(`  · ${shortPage(w.url)} — ${w.before} → ${w.after}`);
    }
    lines.push(
      '',
      '👉 확인 순서: ① 이 페이지들이 아직 색인돼 있는지(GSC URL 검사)',
      '   ② 색인이 정상이면 순위가 아니라 노출 꼬리가 마르는 것 = 권위 부족 → 백링크',
      '   ③ 색인이 빠졌으면 우리가 건드린 것을 의심(사이트맵·리다이렉트·noindex)',
    );
  }

  const text = lines.join('\n');
  console.log(text);

  if (!dry) {
    // Keep the history even on a healthy week — the baseline is the point.
    const past = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : [];
    past.push({
      measured: windows.next.endDate,
      window: windows,
      size: c.size,
      survived: c.survived,
      before: c.before,
      after: c.after,
      delta: c.delta,
      level: v.level,
    });
    mkdirSync(dirname(LEDGER), { recursive: true });
    writeFileSync(LEDGER, `${JSON.stringify(past.slice(-104), null, 2)}\n`);

    // Quiet by default. A weekly "everything is fine" message trains the owner to
    // stop reading the channel, and then the one that matters is missed too.
    if (always || v.level === 'alarm' || v.level === 'watch') await telegram(text);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
