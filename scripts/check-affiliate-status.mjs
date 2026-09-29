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

async function get(url, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(init.headers || {}) } });
  } finally { clearTimeout(t); }
}

// Follow redirects by hand so every hop's URL can be searched for the marker.
async function followLink(url) {
  let cur = url;
  for (let hop = 0; hop < 8; hop++) {
    if (cur.includes(MARKER)) return { verdict: 'ok', detail: new URL(cur).hostname };
    let res;
    try { res = await get(cur, { redirect: 'manual' }); }
    catch (e) { return { verdict: 'unmeasured', detail: e.name === 'AbortError' ? 'timeout' : e.message }; }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      cur = new URL(res.headers.get('location'), cur).href;
      continue;
    }
    if (res.status === 408 || res.status === 429) return { verdict: 'unmeasured', detail: `HTTP ${res.status}` };
    if (res.status >= 400) return { verdict: 'broken', detail: `HTTP ${res.status} at ${new URL(cur).hostname} before the marker appeared` };
    return { verdict: 'broken', detail: `ended at ${new URL(cur).hostname} (HTTP ${res.status}) without marker ${MARKER}` };
  }
  return cur.includes(MARKER) ? { verdict: 'ok', detail: new URL(cur).hostname } : { verdict: 'broken', detail: 'too many redirects' };
}

async function checkWidget(promo) {
  const url = `https://tpemd.com/content?currency=usd&trs=553157&shmarker=${MARKER}&locale=en&powered_by=true&promo_id=${promo}${promo === '4497' ? '&campaign_id=137&city_id=13&category=1&amount=3' : '&campaign_id=100&show_hotels=false&searchUrl=www.aviasales.com%2Fsearch'}`;
  let res;
  try { res = await get(url); } catch (e) { return { verdict: 'unmeasured', detail: e.name === 'AbortError' ? 'timeout' : e.message }; }
  if (res.status >= 500 || res.status === 408 || res.status === 429) return { verdict: 'unmeasured', detail: `HTTP ${res.status}` };
  const len = (await res.text()).trim().length;
  // A widget whose program the marker is not subscribed to answers an empty body.
  return len > 1000 ? { verdict: 'ok', detail: `${len} bytes` } : { verdict: 'broken', detail: `HTTP ${res.status}, ${len} bytes (empty widget)` };
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

if (!rows.length) { console.error('No affiliate links found in the source — the scan is broken, not the links.'); process.exit(1); }
if (!measured.length) { console.error('Nothing could be measured (all network errors) — refusing to pass blind.'); process.exit(1); }
if (broken.length) process.exit(1);
