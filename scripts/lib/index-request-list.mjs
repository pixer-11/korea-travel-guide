// ─────────────────────────────────────────────────────────────
//  INDEX REQUEST LIST — ten URLs a day for a person to hand to Google.
//
//  Google has indexed no new page since 2026-07-25 and fetches ~81 pages a
//  day from a site offering ~12,000 (data/index-coverage-baseline.json); the
//  weekly URL-inspection sample finds 40 of 60 new posts "not crawled" at all.
//  The one direct lever left is Search Console's "Request indexing", which is
//  manual and rationed to roughly ten URLs a day per property. This picks the
//  ten most worth that ration and the morning report prints them, so the
//  owner's daily minute goes to the right pages.
//
//  Order of worth: events that start soon (they earn 0.68 Bing clicks a post
//  against 0.12 for an attraction, and are worthless once over), then the
//  newest other posts. A day index rotates the window through the pool so
//  no URL is listed twice until the pool has cycled; nothing is written to
//  disk, so the report workflow needs no commit step.
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitFrontmatter } from './frontmatter-edit.mjs';

export const SITE = 'https://wanderatlasguides.com';
export const INDEX_FREEZE_DAY = '2026-07-25'; // nothing published after this has been indexed
export const PER_DAY = 10;
export const EVENT_HORIZON_DAYS = 60;
export const ROTATION_ANCHOR = '2026-10-10'; // first morning the list went out

const field = (fm, key) => {
  const m = new RegExp(`^${key}:[ \\t]*(?:'((?:[^']|'')*)'|"([^"]*)"|([^\\n]+))`, 'm').exec(fm);
  return m ? (m[1]?.replace(/''/g, "'") ?? m[2] ?? m[3] ?? '').trim() : '';
};
const day = (s) => (s ? String(s).slice(0, 10) : '');

/** Minimal post records from the posts directory: slug, category, dates, draft. */
export function loadPostsForIndexRequests(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    let fm;
    try { ({ fm } = splitFrontmatter(readFileSync(join(dir, f), 'utf8'))); } catch { continue; }
    if (!fm) continue;
    out.push({
      slug: f.replace(/\.md$/, ''),
      category: field(fm, 'category'),
      pubDate: day(field(fm, 'pubDate')),
      eventStartDate: day(field(fm, 'eventStartDate')),
      draft: /^draft:\s*true\s*$/m.test(fm),
    });
  }
  return out;
}

/** The pool, in order of worth, for a given day (YYYY-MM-DD). Pure. */
export function indexRequestPool(posts, today) {
  const horizon = addDays(today, EVENT_HORIZON_DAYS);
  const live = posts.filter((p) => !p.draft && p.pubDate && p.pubDate >= INDEX_FREEZE_DAY);
  const events = live
    .filter((p) => p.category === 'event' && p.eventStartDate && p.eventStartDate >= today && p.eventStartDate <= horizon)
    .sort((a, b) => a.eventStartDate.localeCompare(b.eventStartDate) || a.slug.localeCompare(b.slug));
  const rest = live
    .filter((p) => !events.includes(p) && !(p.category === 'event' && p.eventStartDate && p.eventStartDate < today))
    .sort((a, b) => b.pubDate.localeCompare(a.pubDate) || a.slug.localeCompare(b.slug));
  return [...events, ...rest];
}

/** Today's slice of the pool: PER_DAY URLs, rotating by day so a week lists 70 different pages. */
export function pickIndexRequests(posts, today, { perDay = PER_DAY } = {}) {
  const pool = indexRequestPool(posts, today);
  if (!pool.length) return [];
  // Counted from the day the list started, so day one is the top of the pool
  // (the soonest events), not an arbitrary point two thousand entries in.
  const dayIndex = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${ROTATION_ANCHOR}T00:00:00Z`)) / 86400e3);
  const start = ((dayIndex * perDay) % pool.length + pool.length) % pool.length;
  const out = [];
  for (let i = 0; i < Math.min(perDay, pool.length); i++) out.push(pool[(start + i) % pool.length]);
  return out;
}

export const postUrl = (slug) => `${SITE}/posts/${slug}/`;

/** Korean lines for the morning Telegram report. */
export function indexRequestLines(picked, today) {
  if (!picked.length) return [];
  const lines = [
    `🔎 오늘 구글 색인 요청 ${picked.length}건 — Search Console › URL 검사 › "색인 생성 요청" (하루 할당량 안에서, 1분)`,
  ];
  for (const p of picked) {
    const tag = p.category === 'event' && p.eventStartDate ? ` (행사 ${p.eventStartDate.slice(5)})` : '';
    lines.push(`• ${postUrl(p.slug)}${tag}`);
  }
  lines.push(`   └ 07-25 이후 글은 구글이 하나도 읽지 않았다. 임박한 행사 → 최신 글 순, 날짜별로 돌아가며 ${today}`);
  return lines;
}

function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
