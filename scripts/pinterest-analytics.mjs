// ─────────────────────────────────────────────────────────────
//  PINTEREST WEEKLY ANALYTICS — collect now, judge later
//
//  The auto-pinner (pinterest-publish.mjs) has posted since 2026-08-08 but
//  nothing ever read the numbers back, so the November "is Pinterest worth
//  keeping" verdict would have been a guess. This collector asks the API for
//  each pin's impressions / saves / clicks once a week and accumulates them in
//  data/pinterest-analytics.json — the same measure-at-birth rule the publish
//  gate follows. The LEARNING step (feeding winners back into pin selection,
//  like the topic-yield queue ordering) is deliberately deferred until a few
//  weeks of samples exist; collection cannot be deferred or there will be no
//  past to learn from.
//
//  Token: same resolution as the publisher — PINTEREST_ACCESS_TOKEN override
//  or the encrypted OAuth store (PINTEREST_APP_SECRET + data/pinterest-token.enc),
//  which only decrypts where the app secret lives (GitHub Actions).
// ─────────────────────────────────────────────────────────────
import { readFile, writeFile } from 'node:fs/promises';
import { getAccessToken } from './lib/pinterest-token.mjs';

const API = process.env.PINTEREST_API_BASE || 'https://api.pinterest.com/v5';
let TOKEN = process.env.PINTEREST_ACCESS_TOKEN;
const STATE_FILE = 'data/pinterest.json';
const OUT_FILE = 'data/pinterest-analytics.json';
const METRICS = 'IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`GET ${path} → ${res.status}: ${body.message || JSON.stringify(body).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// Analytics responses nest per app type; "ALL" carries the account-wide view.
// summary_metrics keys mirror the requested metric_types. Shapes have shifted
// between API revisions, so read defensively and keep the raw keys of the
// first pin in the log the day the shape drifts again.
export function extractSummary(body) {
  const all = body?.all ?? body?.ALL ?? body;
  const s = all?.summary_metrics ?? all?.lifetime_metrics ?? {};
  const n = (k) => Number(s[k] ?? 0) || 0;
  return {
    impressions: n('IMPRESSION'),
    saves: n('SAVE'),
    pinClicks: n('PIN_CLICK'),
    outboundClicks: n('OUTBOUND_CLICK'),
  };
}

// Korean weekly digest. Kept small and pure so the wording is testable.
export function summarize(pins, { start, end } = {}) {
  const tot = (k) => pins.reduce((n, p) => n + (p[k] || 0), 0);
  const seen = pins.filter((p) => p.impressions > 0);
  const top = [...pins].sort((a, b) => b.impressions - a.impressions).slice(0, 5)
    .filter((p) => p.impressions > 0)
    .map((p) => `  • ${p.slug} — 노출 ${p.impressions}${p.outboundClicks ? ` · 방문 ${p.outboundClicks}` : ''}`);
  const byCountry = {};
  for (const p of pins) {
    if (!p.country) continue;
    (byCountry[p.country] ??= { n: 0, i: 0 }).n++;
    byCountry[p.country].i += p.impressions || 0;
  }
  const countries = Object.entries(byCountry)
    .filter(([, v]) => v.i > 0)
    .sort((a, b) => b[1].i - a[1].i).slice(0, 3)
    .map(([c, v]) => `${c} ${v.i}`).join(' · ');
  return [
    `📌 핀터레스트 주간 성적표 (${start}~${end})`,
    `핀 ${pins.length}개: 노출 ${tot('impressions')} · 저장 ${tot('saves')} · 핀 클릭 ${tot('pinClicks')} · 사이트 방문 ${tot('outboundClicks')}`,
    `노출이 있었던 핀: ${seen.length}/${pins.length}`,
    ...(top.length ? ['노출 상위:', ...top] : ['아직 노출된 핀이 없습니다 — 신규 계정 문턱(3~6개월) 구간이라 정상입니다.']),
    ...(countries ? [`나라별 노출: ${countries}`] : []),
  ].join('\n');
}

async function main() {
  if (!TOKEN && process.env.PINTEREST_APP_SECRET) {
    try {
      TOKEN = await getAccessToken();
    } catch (e) {
      console.log(`Token unavailable: ${e.message}`);
      console.log('PIN_ANALYTICS_AUTH_FAILED');
      return;
    }
  }
  if (!TOKEN) {
    console.log('No Pinterest credentials — skipping.');
    return;
  }

  const state = JSON.parse(await readFile(STATE_FILE, 'utf8'));
  const pinned = Object.entries(state.pinned || {});
  if (!pinned.length) { console.log('No pins recorded yet.'); return; }

  // Post metadata (country/category) so the digest can group results.
  const meta = {};
  const { readdirSync, readFileSync, existsSync } = await import('node:fs');
  for (const [slug] of pinned) {
    const f = `src/content/posts/${slug}.md`;
    if (!existsSync(f)) continue;
    const src = readFileSync(f, 'utf8').slice(0, 2500);
    meta[slug] = {
      country: (src.match(/^country:\s*"?([^"\n]+?)"?\s*$/m) || [])[1],
      category: (src.match(/^category:\s*"?([^"\n]+?)"?\s*$/m) || [])[1],
    };
  }

  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const rows = [];
  let failed = 0, firstShapeLogged = false;
  for (const [slug, pinId] of pinned) {
    try {
      const body = await api(`/pins/${pinId}/analytics?start_date=${start}&end_date=${end}&metric_types=${METRICS}&app_types=ALL`);
      if (!firstShapeLogged) {
        console.log(`shape keys: ${Object.keys(body).join(',')}`);
        firstShapeLogged = true;
      }
      rows.push({ slug, pinId, ...(meta[slug] || {}), ...extractSummary(body) });
    } catch (e) {
      if (e.status === 401 || e.status === 403) { console.log(`PIN_ANALYTICS_AUTH_FAILED ${e.message}`); return; }
      failed++;
      console.log(`  ⚠️  ${slug}: ${e.message}`);
    }
    await sleep(350);
  }

  // Latest detail + an append-only weekly totals series (small forever).
  let out = { weeks: [] };
  try { out = JSON.parse(await readFile(OUT_FILE, 'utf8')); } catch { /* first run */ }
  out.at = new Date().toISOString();
  out.window = { start, end };
  out.pins = rows;
  out.weeks = [...(out.weeks || []), {
    at: end,
    pins: rows.length,
    impressions: rows.reduce((n, p) => n + p.impressions, 0),
    saves: rows.reduce((n, p) => n + p.saves, 0),
    outboundClicks: rows.reduce((n, p) => n + p.outboundClicks, 0),
  }].slice(-52);
  await writeFile(OUT_FILE, JSON.stringify(out, null, 1) + '\n', 'utf8');

  const digest = summarize(rows, { start, end });
  console.log(digest);
  if (failed) console.log(`조회 실패 ${failed}건 (다음 주에 다시 시도)`);
  console.log(`PIN_ANALYTICS pins=${rows.length} impressions=${out.weeks.at(-1).impressions} clicks=${out.weeks.at(-1).outboundClicks} failed=${failed}`);
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) await main();
