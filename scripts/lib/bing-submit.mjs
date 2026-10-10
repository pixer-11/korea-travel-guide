// ─────────────────────────────────────────────────────────────
//  BING URL SUBMISSION — direct submission on top of IndexNow.
//
//  Bing's IndexNow Insights on 2026-10-10: 33.4K URLs submitted, 2.6K
//  crawled, 2K indexed. IndexNow tells Bing a URL exists; it does not make
//  Bing fetch it. The URL Submission API is the other door, with its own
//  adaptive per-site quota (100/day and 2,200/month for this site on
//  2026-10-10), and URLs that go through it are fetched with priority. Bing
//  is the one search engine sending clicks (257/week) and its AI Performance
//  report shows 6 of the 7 most-cited pages are Japanese, so the order of
//  worth is: events starting soon (en + ja), then every Japanese post, then
//  English, then zh/es/ko. A day index rotates a window of the day's quota
//  through that pool, like the Search Console list; nothing is written to
//  disk and nothing is submitted twice until the pool has cycled.
//
//  Never throws out of the script: a refused batch is a warning line, the
//  IndexNow job that hosts it stays green.
// ─────────────────────────────────────────────────────────────
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
// No gray-matter here on purpose: indexnow.yml runs without npm ci
// (scripts/workflow-deps.test.mjs guards that), so the front matter is cut
// out with the fence regex alone. Only four scalar keys are read.
const frontmatterOf = (raw) => {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  return m ? m[1] : null;
};

export const SITE = 'https://wanderatlasguides.com/';
const API = 'https://ssl.bing.com/webmaster/api.svc/json';
export const ROTATION_ANCHOR = '2026-10-10';
export const MAX_PER_RUN = 100;
export const EVENT_HORIZON_DAYS = 60;
const LANGS = ['ja', 'en', 'zh', 'es', 'ko'];

const field = (fm, key) => {
  const m = new RegExp(`^${key}:[ \\t]*(?:'((?:[^']|'')*)'|"([^"]*)"|([^\\n]+))`, 'm').exec(fm);
  return m ? (m[1]?.replace(/''/g, "'") ?? m[2] ?? m[3] ?? '').trim() : '';
};
const day = (s) => (s ? String(s).slice(0, 10) : '');

/** Live posts with the languages that have a translation file. */
export function loadPostsForBing(contentDir) {
  const postsDir = join(contentDir, 'posts');
  const out = [];
  for (const f of readdirSync(postsDir)) {
    if (!f.endsWith('.md')) continue;
    let fm;
    try { fm = frontmatterOf(readFileSync(join(postsDir, f), 'utf8')); } catch { continue; }
    if (!fm || /^draft:\s*true\s*$/m.test(fm)) continue;
    const slug = f.replace(/\.md$/, '');
    const langs = ['en', ...['ja', 'zh', 'es', 'ko'].filter((l) => existsSync(join(contentDir, 'i18n', l, `${slug}.md`)))];
    out.push({ slug, category: field(fm, 'category'), pubDate: day(field(fm, 'pubDate')), eventStartDate: day(field(fm, 'eventStartDate')), langs });
  }
  return out;
}

export const postUrl = (slug, lang) => `${SITE}${lang === 'en' ? '' : lang + '/'}posts/${slug}/`;

/** Ordered pool of URLs for a given day. Pure. */
export function bingSubmitPool(posts, today) {
  const horizon = addDays(today, EVENT_HORIZON_DAYS);
  const isSoonEvent = (p) => p.category === 'event' && p.eventStartDate && p.eventStartDate >= today && p.eventStartDate <= horizon;
  const isOverEvent = (p) => p.category === 'event' && p.eventStartDate && p.eventStartDate < today;
  const byNewest = (a, b) => b.pubDate.localeCompare(a.pubDate) || a.slug.localeCompare(b.slug);
  const live = posts.filter((p) => !isOverEvent(p));
  const tiers = [], seen = new Set();
  const add = (u) => { if (!seen.has(u)) { seen.add(u); tiers.push(u); } };
  const soon = live.filter(isSoonEvent).sort((a, b) => a.eventStartDate.localeCompare(b.eventStartDate) || a.slug.localeCompare(b.slug));
  for (const lang of ['en', 'ja']) for (const p of soon) if (p.langs.includes(lang)) add(postUrl(p.slug, lang));
  const newest = [...live].sort(byNewest);
  for (const lang of LANGS) for (const p of newest) if (p.langs.includes(lang)) add(postUrl(p.slug, lang));
  return tiers;
}

/** Today's slice: `quota` URLs, rotating by day from the anchor. */
export function pickBingSubmissions(posts, today, quota) {
  const pool = bingSubmitPool(posts, today);
  const n = Math.min(Math.max(0, quota | 0), MAX_PER_RUN, pool.length);
  if (!n) return [];
  const dayIndex = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${ROTATION_ANCHOR}T00:00:00Z`)) / 86400e3);
  const start = ((dayIndex * MAX_PER_RUN) % pool.length + pool.length) % pool.length;
  const out = [];
  for (let i = 0; i < n; i++) out.push(pool[(start + i) % pool.length]);
  return out;
}

/** { daily, monthly } remaining, or null when the call fails. */
export async function getSubmissionQuota(key, fetchImpl = fetch) {
  const r = await fetchImpl(`${API}/GetUrlSubmissionQuota?siteUrl=${encodeURIComponent(SITE)}&apikey=${encodeURIComponent(key)}`);
  if (!r.ok) throw new Error(`GetUrlSubmissionQuota: HTTP ${r.status}`);
  const d = (await r.json())?.d;
  if (!d || typeof d !== 'object') throw new Error('GetUrlSubmissionQuota: no quota object');
  return { daily: Number(d.DailyQuota ?? d.dailyQuota ?? 0), monthly: Number(d.MonthlyQuota ?? d.monthlyQuota ?? 0) };
}

/** One batch. Bing answers 200 with {"d":null} on success. */
export async function submitUrlBatch(key, urls, fetchImpl = fetch) {
  const r = await fetchImpl(`${API}/SubmitUrlBatch?apikey=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ siteUrl: SITE, urlList: urls }),
  });
  const text = await r.text().catch(() => '');
  if (!r.ok) throw new Error(`SubmitUrlBatch: HTTP ${r.status} ${text.slice(0, 200)}`);
  return urls.length;
}

function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
