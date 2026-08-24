#!/usr/bin/env node
// A 301 ONLY TRANSFERS RANKING IF THE TARGET IS ABOUT THE SAME THING.
//
// The lesson of 2026-07-26. Ninety-two photo-unfixable posts were retired and
// each 301'd to its /regions/ hub — 460 URLs with translations. The redirects
// all worked (200 at the end of the hop), so a later check called the deletion
// harmless. It was not. The next day site-wide average position fell 11.8 → 57.4
// and a month later it had not moved.
//
// Why: a 301 tells Google "what used to be here now lives there." When "there"
// never mentions the venue that earned the ranking, Google has nothing to rank
// the target for — the ranking does not transfer, it ENDS. Verified 2026-08-25:
//   /regions/kuala-lumpur/  — "Muljil" appears 0 times
//   /regions/little-india/  — "Chola Cafe" appears 0 times
//   /regions/bangkok/       — "F Forever" appears 0 times
// Worse, Chola Cafe still held position 4.5, so live searchers were landing on a
// district page that never names what they searched for — a bounce signal that
// damages the hub's own standing too.
//
// So: a hub is an acceptable destination for a reader, but never a ranking
// heir. This audit names every retired post whose redirect cannot carry its
// ranking, so the choice is explicit rather than accidental.
//
// The alternatives, in order of preference:
//   1. Restore the post (get the photo). Its ranking history is proven.
//   2. 301 to a genuinely equivalent page about the SAME venue.
//   3. 410 Gone — honest, drops the URL cleanly, and does not contaminate the
//      hub's relevance the way a mismatched 301 does.
//
//   node scripts/audit-retired-redirects.mjs [--json]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const JSON_OUT = process.argv.includes('--json');
const RETIRED = 'data/retired-posts.json';
const POSTS = 'src/content/posts';
const REGIONS = 'src/content/regions';

if (!existsSync(RETIRED)) {
  console.log('은퇴 목록이 없다 — 검사할 것 없음.');
  process.exit(0);
}
const retired = JSON.parse(readFileSync(RETIRED, 'utf8'));
const live = new Set(readdirSync(POSTS).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)));

// The distinctive part of a venue slug: drop the leading city tokens, which the
// hub obviously contains. "kuala-lumpur-muljil" → "muljil". Multi-word cities
// are handled by matching the stored region name rather than guessing token count.
const venuePart = (slug, region) => {
  const regionTokens = String(region || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').split('-').filter(Boolean);
  let tokens = slug.split('-');
  while (tokens.length > 1 && regionTokens.includes(tokens[0])) tokens = tokens.slice(1);
  return tokens.join(' ');
};

// Read whatever text the hub actually carries. A region hub is generated from
// its live posts, so the reliable signal is: does any LIVE post in that region
// name this venue? That is what Google would have to match against.
const regionText = (region) => {
  const slug = String(region || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const file = join(REGIONS, slug + '.md');
  let text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  for (const f of readdirSync(POSTS)) {
    if (!f.endsWith('.md')) continue;
    if (!f.startsWith(slug + '-')) continue;
    text += ' ' + readFileSync(join(POSTS, f), 'utf8');
  }
  return text.toLowerCase();
};

const rows = [];
const regionCache = new Map();
for (const r of retired) {
  if (live.has(r.slug)) continue; // already restored — no redirect in play
  const venue = venuePart(r.slug, r.region);
  if (!regionCache.has(r.region)) regionCache.set(r.region, regionText(r.region));
  const hub = regionCache.get(r.region);
  // Match on the distinctive words, not the whole phrase: a hub may name the
  // venue in a slightly different form ("Bánh Mì 25" vs "banh-mi-25").
  const words = venue.split(' ').filter((w) => w.length > 2);
  const hit = words.length > 0 && words.every((w) => hub.includes(w));
  rows.push({ slug: r.slug, region: r.region, venue, carries: hit });
}

const orphans = rows.filter((x) => !x.carries);

if (JSON_OUT) {
  console.log(JSON.stringify({ total: rows.length, orphans: orphans.length, rows }, null, 2));
  process.exit(0);
}

console.log(`은퇴 후 리다이렉트 중인 글 ${rows.length}편 검사\n`);
if (!orphans.length) {
  console.log('✅ 모든 리다이렉트 목적지가 원래 장소를 언급한다 — 순위가 이어질 수 있다.');
  process.exit(0);
}

console.log(`⚠️  ${orphans.length}편은 목적지가 원래 장소를 한 번도 언급하지 않는다.`);
console.log('   이 301은 방문자는 옮기지만 순위는 옮기지 못한다. 사진 복구 또는 410을 검토할 것.\n');
for (const o of orphans.slice(0, 30)) {
  console.log(`   ${o.slug}`);
  console.log(`      → /regions/${String(o.region).toLowerCase().replace(/[^a-z0-9]+/g, '-')}/  ("${o.venue}" 언급 없음)`);
}
if (orphans.length > 30) console.log(`   … 외 ${orphans.length - 30}편`);
console.log(`\n근거: 보고서-2026-08-25-전면SEO감사.md`);
// Informational by design — this is a standing decision list for the owner, not
// a build breaker. Exit 0 so it can ride along in a sweep without failing it.
