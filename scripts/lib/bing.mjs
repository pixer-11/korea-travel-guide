// One Bing line for the weekly Google report.
//
// Why: the Google index froze on 2026-07-25 and the Google report reads
// "0 clicks" week after week, while Bing gave 228 clicks the week of
// 09-26..10-03 (Google: 0 of 409 impressions). The full Bing block already
// lands every morning in the daily analytics report (lib/bing-report.mjs);
// this line only puts the two channels side by side, with the same arithmetic
// (bingDaily: the last seven recorded days against the seven before) and the
// same caveat that Bing's daily figures run 3–4 days late.
//
// Key: BING_API_KEY (.env locally, the Actions secret of the same name). The
// site URL is fixed here on purpose: process.env.SITE_URL holds a placeholder
// in .env (memory: bing-is-the-real-channel).
import { bingDaily } from './bing-report.mjs';

const SITE = 'https://wanderatlasguides.com/';
const API = 'https://ssl.bing.com/webmaster/api.svc/json';

export async function bingCall(method, key, fetchImpl = fetch) {
  const r = await fetchImpl(`${API}/${method}?siteUrl=${encodeURIComponent(SITE)}&apikey=${encodeURIComponent(key)}`);
  if (!r.ok) throw new Error(`Bing ${method}: HTTP ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j?.d)) throw new Error(`Bing ${method}: no data array`);
  return j.d;
}

/**
 * The line, or a line saying why there is none — never zeros for "could not
 * see" (a report that cannot see must not look calm).
 */
export async function bingWeekLine(key, fetchImpl = fetch) {
  if (!key) return '🅱️ 빙: BING_API_KEY 가 없어 못 봤다';
  try {
    const d = bingDaily(await bingCall('GetRankAndTrafficStats', key, fetchImpl));
    if (!d) return '🅱️ 빙: 일별 기록이 7일치가 안 돼 비교하지 않는다';
    const md = new Date(d.to).toISOString().slice(5, 10);
    const was = d.prev ? `, 직전 7일 ${d.prev.clicks}${d.prev.clicks ? ` (${d.last.clicks >= d.prev.clicks ? '+' : ''}${Math.round(((d.last.clicks - d.prev.clicks) / d.prev.clicks) * 100)}%)` : ''}` : '';
    return `🅱️ 빙 최근 7일(${md}까지): 👆 클릭 ${d.last.clicks}${was} · 👀 노출 ${d.last.imp} — 검색어별은 매일 09시 분석 리포트`;
  } catch (e) {
    return `🅱️ 빙: 조회 실패 — ${String(e.message).slice(0, 120)}`;
  }
}
