#!/usr/bin/env node
// Daily health check of the affiliate links the site actually ships.
//
// Until 2026-09-29 this pinged the Hotellook widget and waited for it to "go
// live". Hotellook closed on 2025-10-20, so the endpoint answers an empty body
// forever: the job printed "PENDING — under review" every day and stayed green,
// guarding nothing. What does break is ours — on 07-21 the Kiwitaxi shortlink
// was transcribed with a lowercase l for a capital I and 404'd for six days
// while every click earned nothing. So the question now is: does each link the
// site ships still reach the partner WITH our marker (754088) attached?
//
// The list is read from the source, not kept here, so a link added or changed
// in a component is checked the next morning without anyone editing this file.
//
// Verdicts, per "못 잰 것은 판정이 아니다": a link is BROKEN only on evidence (a 4xx
// or 5xx before the marker ever appears, or a chain that ends without it). A
// timeout or network error is UNMEASURED, not broken — Klook answers bots with
// 403 at the END of the chain, after the marker is already in the redirect URL,
// which is fine. If nothing at all could be measured the run fails too: a
// checker that saw nothing must not pass.
//
//   node scripts/check-affiliate-status.mjs
import { appendFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MARKER = '754088';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const SRC = process.argv[2] || 'src';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(astro|mjs|js|ts)$/.test(name)) out.push(p);
  }
  return out;
}

// Travelpayouts shortlinks (…tpx.lv/<code>) and the partner widget scripts.
const links = new Map();   // url → first file that uses it
const widgets = new Map();
for (const f of walk(SRC)) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/https:\/\/(?:[a-z0-9-]+\.)?tpx\.lv\/[A-Za-z0-9]+/g)) if (!links.has(m[0])) links.set(m[0], f);
  // Widget URLs are template strings; keep only the static prefix up to promo/campaign.
  for (const m of text.matchAll(/https:\/\/tpemd\.com\/content\?[^`'"\s]*promo_id=(\d+)/g)) {
    if (![...widgets.values()].some((w) => w.promo === m[1])) widgets.set(m[1], { promo: m[1], file: f });
  }
}

// The timeout covers the BODY too (withBody): a connection that drops after the
// headers must come back as a network error, not escape as an unhandled throw.
async function get(url, init = {}, withBody = false) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(init.headers || {}) } });
    return withBody ? { res, body: await res.text() } : { res, body: '' };
  } finally { clearTimeout(t); }
}

// Seeing 754088 is not always enough. Klook credits a click only through the
// token Travelpayouts mints into aid=api|13694|<token>-754088; the worker's own
// fallback carries an EMPTY token (api|13694|-754088), still reaches Klook and
// earns nothing (worker/index.mjs, "Klook click relay"). Codex review 09-29.
// Only the aid parameter itself is judged (URLSearchParams decodes it safely —
// a stray "%" elsewhere in the URL must not throw, and a token-looking string
// in some other parameter must not vouch for an empty aid).
const KLOOK_AID = new RegExp(String.raw`^api\|13694\|[0-9a-f]{8,}-${MARKER}(\||$)`);
function markerProblem(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname === 'affiliate.klook.com' && !KLOOK_AID.test(u.searchParams.get('aid') ?? '')) {
    return 'Klook aid has no click token (api|13694|-754088) — reaches Klook but cannot be credited';
  }
  return null;
}

// Follow redirects by hand so every hop's URL can be searched for the marker.
// MAX_HOPS redirects are followed and the URL they land on is still judged.
const MAX_HOPS = 8;
async function followLink(url) {
  let cur = url;
  for (let hop = 0; ; hop++) {
    if (cur.includes(MARKER)) {
      const why = markerProblem(cur);
      return why ? { verdict: 'broken', detail: why } : { verdict: 'ok', detail: new URL(cur).hostname };
    }
    if (hop === MAX_HOPS) return { verdict: 'broken', detail: 'too many redirects' };
    let res;
    try { ({ res } = await get(cur, { redirect: 'manual' })); }
    catch (e) { return { verdict: 'unmeasured', detail: e.name === 'AbortError' ? 'timeout' : e.message }; }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      cur = new URL(res.headers.get('location'), cur).href;
      continue;
    }
    if (res.status === 408 || res.status === 429) return { verdict: 'unmeasured', detail: `HTTP ${res.status}` };
    if (res.status >= 400) return { verdict: 'broken', detail: `HTTP ${res.status} at ${new URL(cur).hostname} before the marker appeared` };
    return { verdict: 'broken', detail: `ended at ${new URL(cur).hostname} (HTTP ${res.status}) without marker ${MARKER}` };
  }
}

const WIDGET_BASE = process.env.WIDGET_BASE || 'https://tpemd.com';   // overridable only for the test
async function checkWidget(promo) {
  const url = `${WIDGET_BASE}/content?currency=usd&trs=553157&shmarker=${MARKER}&locale=en&powered_by=true&promo_id=${promo}${promo === '4497' ? '&campaign_id=137&city_id=13&category=1&amount=3' : '&campaign_id=100&show_hotels=false&searchUrl=www.aviasales.com%2Fsearch'}`;
  let res, body;
  try { ({ res, body } = await get(url, {}, true)); } catch (e) { return { verdict: 'unmeasured', detail: e.name === 'AbortError' ? 'timeout' : e.message }; }
  if (res.status >= 500 || res.status === 408 || res.status === 429) return { verdict: 'unmeasured', detail: `HTTP ${res.status}` };
  const text = body.trim();
  // A widget whose program the marker is not subscribed to answers an empty body;
  // an error page is HTML. Only a 2xx JavaScript body counts (codex review 09-29:
  // a 2.6 KB 403 page used to pass on length alone).
  if (!res.ok) return { verdict: 'broken', detail: `HTTP ${res.status}` };
  if (text.length <= 1000) return { verdict: 'broken', detail: `HTTP ${res.status}, ${text.length} bytes (empty widget)` };
  // HTML by header, or by how the body STARTS once leading comments are skipped
  // (a proxy error page can open with one). Not "contains <html>" — a healthy
  // widget script may carry an iframe document string (codex review, 3rd pass).
  const lead = text.replace(/^(\s*<!--[\s\S]*?-->)+\s*/, '');
  const isHtml = /text\/html/i.test(res.headers.get('content-type') ?? '') || /^<(!doctype\s+html|html[\s>])/i.test(lead);
  if (isHtml) return { verdict: 'broken', detail: `HTTP ${res.status}, an HTML page instead of the widget script` };
  return { verdict: 'ok', detail: `${text.length} bytes` };
}

// The hotel button is not a shortlink: it goes through our own worker route
// /go/klook, which attaches the marker server-side (since 09-23 every hotel
// button in the site uses it). Build the URL with the site's own function so a
// break in either the builder or the worker shows up here. sub_id
// hotel_status_check keeps these probe clicks separable in the partner report.
const SITE = process.env.SITE_URL || 'https://wanderatlasguides.com';
try {
  const { hotelUrl } = await import(new URL('../src/lib/hotel-link.mjs', import.meta.url));
  links.set(SITE + hotelUrl({ submarker: 'status_check', locale: 'en-US', place: 'Seoul', country: 'South Korea' }), 'src/lib/hotel-link.mjs');
} catch (e) {
  console.error(`hotel-link.mjs could not be loaded: ${e.message}`);
  links.set(`${SITE}/go/klook (hotel-link.mjs failed to load)`, 'src/lib/hotel-link.mjs');
}

const rows = [];
for (const [url, file] of links) {
  if (!/^https?:\/\//.test(url)) { rows.push({ what: url, file, verdict: 'broken', detail: 'hotel link builder is broken' }); continue; }
  let r = await followLink(url);
  if (r.verdict === 'unmeasured') r = await followLink(url);   // one retry for a flaky hop
  rows.push({ what: url, file, ...r });
}
for (const { promo, file } of widgets.values()) {
  let r = await checkWidget(promo);
  if (r.verdict === 'unmeasured') r = await checkWidget(promo);
  rows.push({ what: `widget promo_id=${promo}`, file, ...r });
}

const icon = { ok: '✅', broken: '❌', unmeasured: '⚪' };
for (const r of rows) console.log(`${icon[r.verdict]} ${r.what}  — ${r.detail}  (${r.file})`);

const broken = rows.filter((r) => r.verdict === 'broken');
const measured = rows.filter((r) => r.verdict !== 'unmeasured');
const summary = `AFFILIATE_STATUS links=${links.size} widgets=${widgets.size} ok=${measured.length - broken.length} broken=${broken.length} unmeasured=${rows.length - measured.length}`;
console.log(summary);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Affiliate links\n\n${rows.map((r) => `- ${icon[r.verdict]} \`${r.what}\` — ${r.detail}`).join('\n')}\n\n${summary}\n`);
}

// exitCode, not process.exit(): exiting while fetch's keep-alive sockets are
// still open crashes Node on Windows (0xC0000409) instead of returning 1.
if (!rows.length) { console.error('No affiliate links found in the source — the scan is broken, not the links.'); process.exitCode = 1; }
else if (!measured.length) { console.error('Nothing could be measured (all network errors) — refusing to pass blind.'); process.exitCode = 1; }
else if (broken.length) process.exitCode = 1;
