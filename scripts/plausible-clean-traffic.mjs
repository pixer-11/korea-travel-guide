#!/usr/bin/env node
// 기간의 Plausible 방문을 '자동 접속 덩어리'를 뺀 값으로 센다 — 월간 판정용.
//
// 일일 리포트는 하루마다 덩어리를 찾아 뺀다(lib/plausible-bot-cluster.mjs). 그런데 월간
// 제휴사 재심사 점검(예약 작업 travelpayouts-unlock-check-monthly: 3개월 연속 방문 700·
// 전달 대비 -20% 이내)은 월 합계를 직접 물었고, 2026-10 의 4,026 방문 중 ~1,100 이
// 10-29·30 의 크롬 151 덩어리였다. 그대로 두면 10월이 부풀고 11월이 '급감'으로 읽힌다.
//
// 날마다 따로 판별하고 **그날의 덩어리만 그날에서** 뺀 뒤 더한다(코덱스 10-31: 한 날에 찾은
// 지문을 기간 전체에 적용하면 다른 날의 사람과, 판별에 실패한 날까지 빠진다). 방문(visits)과
// 페이지뷰는 날짜끼리 더해도 맞다. 방문자(visitors)는 고유 인원이라 더하면 겹치므로,
// 기간 방문자는 '그대로' 값만 내고 덩어리 몫은 일별 합(겹침 포함)으로만 적는다.
// 판별에 실패한 날은 그대로 더하고 그 날짜를 적는다 — 못 본 날은 빼지 않는다.
//
//   node scripts/plausible-clean-traffic.mjs --from=2026-10-01 --to=2026-10-31 [--countries] [--json]
import { detectBotClusters, excludeClusters, describeCluster } from './lib/plausible-bot-cluster.mjs';

const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
const from = arg('from');
const to = arg('to');
const wantCountries = process.argv.includes('--countries');
const asJson = process.argv.includes('--json');
if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
  console.error('사용법: node scripts/plausible-clean-traffic.mjs --from=YYYY-MM-DD --to=YYYY-MM-DD [--countries] [--json]');
  process.exit(2);
}
const SITE = process.env.PLAUSIBLE_SITE_ID || 'wanderatlasguides.com';

async function query(range, body) {
  const r = await fetch(`https://plausible.io/api/stats/${encodeURIComponent(SITE)}/query/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (WanderAtlas clean traffic)' },
    body: JSON.stringify({ site_id: SITE, date_range: range, filters: [], dimensions: [], ...body }),
  });
  if (!r.ok) throw new Error(`Plausible public ${r.status}: ${(await r.text()).slice(0, 120)}`);
  const j = await r.json();
  // 200 인데 results 가 없으면 '0'이 아니라 '못 받았다'.
  if (!Array.isArray(j?.results)) throw new Error('Plausible 응답에 results 가 없다');
  return j.results;
}
// 집계 한 줄을 요청한 지표 수만큼 정확히 받았는지 확인 — 비면 0 이 아니라 오류.
async function totals(range, metrics, filters = []) {
  const [row] = await query(range, { metrics, filters });
  if (!row || !Array.isArray(row.metrics) || row.metrics.length !== metrics.length) throw new Error('집계 행이 비었다');
  return Object.fromEntries(metrics.map((m, i) => [m, Number(row.metrics[i]) || 0]));
}
const dayRange = (d) => [`${d}T00:00:00+00:00`, `${d}T23:59:59+00:00`];
const fullRange = [`${from}T00:00:00+00:00`, `${to}T23:59:59+00:00`];
const M = ['visits', 'pageviews'];

const raw = await totals(fullRange, ['visitors', ...M]);
const clean = { visits: 0, pageviews: 0 };
const found = new Map(); // 조합 → { cluster, days: [{day, visitors}] }
const removedByDay = []; // [{day, visits}] — 그날 덩어리 전부를 뺀 몫(덩어리가 둘이어도 한 번)
let rawDaySum = 0;       // 날짜별 '그대로' 방문의 합 — 기간 합과 맞는지 검산
const failedDays = [];
const byCountry = new Map();
for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
  const d = new Date(t).toISOString().slice(0, 10);
  const { clusters, error } = await detectBotClusters((body) => query(dayRange(d), body));
  if (error) failedDays.push(`${d}(${error.slice(0, 40)})`);
  const ex = excludeClusters(clusters);
  const dayRaw = await totals(dayRange(d), M);
  const dayClean = ex.length ? await totals(dayRange(d), M, ex) : dayRaw;
  rawDaySum += dayRaw.visits;
  clean.visits += dayClean.visits;
  clean.pageviews += dayClean.pageviews;
  if (clusters.length) removedByDay.push({ day: d, visits: dayRaw.visits - dayClean.visits });
  for (const c of clusters) {
    const k = c.values.join('|');
    if (!found.has(k)) found.set(k, { cluster: c, days: [] });
    found.get(k).days.push({ day: d, visitors: c.visitors });
  }
  if (wantCountries) {
    const rows = await query(dayRange(d), { metrics: ['visits'], dimensions: ['visit:country'], filters: ex, pagination: { limit: 60 } });
    for (const r of rows) byCountry.set(r.dimensions[0], (byCountry.get(r.dimensions[0]) ?? 0) + (r.metrics[0] ?? 0));
  }
}
// 일별 합이 기간 합과 어긋나면(경계·지연 집계) 숫자를 믿지 말라고 적는다.
const out = {
  from, to, raw, clean,
  rawDaySumVisits: rawDaySum,
  removedByDay,
  clusters: [...found.values()].map((x) => ({ what: describeCluster(x.cluster), values: x.cluster.values, days: x.days })),
  failedDays,
};
if (wantCountries) out.cleanVisitsByCountry = Object.fromEntries([...byCountry].sort((a, b) => b[1] - a[1]));

if (asJson) console.log(JSON.stringify(out, null, 1));
else {
  console.log(`${from} ~ ${to}`);
  console.log(`  그대로: 방문자 ${raw.visitors} · 방문 ${raw.visits} · 페이지뷰 ${raw.pageviews}`);
  console.log(`  자동 접속 덩어리 뺀 값: 방문 ${clean.visits} · 페이지뷰 ${clean.pageviews} (방문자는 고유 인원이라 날짜끼리 더할 수 없어 생략)`);
  if (Math.abs(rawDaySum - raw.visits) > Math.max(3, raw.visits * 0.01)) console.log(`  ⚠️ 날짜별 합(${rawDaySum})이 기간 합(${raw.visits})과 1% 넘게 어긋난다 — 집계가 아직 덜 끝났을 수 있다`);
  for (const c of out.clusters) console.log(`  뺀 덩어리: ${c.what} — ${c.days.map((x) => `${x.day.slice(5)} ${x.visitors}명`).join(', ')}`);
  if (removedByDay.length) console.log(`  날짜별로 뺀 방문: ${removedByDay.map((x) => `${x.day.slice(5)} ${x.visits}`).join(', ')}`);
  if (!out.clusters.length) console.log('  뺀 덩어리 없음');
  if (failedDays.length) console.log(`  ⚠️ 덩어리 판별에 실패해 그대로 더한 날 ${failedDays.length}일: ${failedDays.join(', ')}`);
  if (out.cleanVisitsByCountry) console.log('  나라별 방문(뺀 값):', Object.entries(out.cleanVisitsByCountry).slice(0, 30).map(([k, v]) => `${k} ${v}`).join(' · '));
}
