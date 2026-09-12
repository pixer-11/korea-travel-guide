#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  OG:IMAGE WIDTH AUDIT — Google Discover only serves the large card when the
//  share image is ≥1200px wide. The per-POST invariant (og:image = the original
//  hero, never the 640px wall thumb) was fixed on 2026-08-02, but it was never
//  applied to the pages that pick a share image from among their children:
//  the home page and the hubs. A hub whose first child happens to have a
//  1024px hero disqualifies itself (found 2026-08-06).
//
//  Reports one row per distinct og:image URL, so a narrow image shared by
//  twelve language variants is one line, not twelve.
//
//    node scripts/audit-og-width.mjs            # after `npm run build`
//    node scripts/audit-og-width.mjs --all      # posts too, not just hubs
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { probeWidth } from './lib/image-width.mjs';
import { requireExamined } from './lib/examined.mjs';

const DIST = 'dist';

// Without this the walk throws ENOENT and prints a stack trace, which reads as
// a broken script rather than "you have not built yet". Same one-line refusal
// check-heading-skips has carried since 2026-09-07.
if (!existsSync(DIST)) {
  console.log('OG-WIDTH-UNCHECKED: dist/ 없음 — 아무것도 검사하지 못했다. 빌드 먼저.');
  process.exit(1);
}
const MIN_WIDTH = 1200;
const ALL = process.argv.includes('--all');

// Pages that CHOOSE a share image rather than owning one. These are the ones
// this audit exists for; posts carry their own hero and are covered by
// scan-hero-widths.mjs.
const isHubPath = (rel) => {
  const p = rel.replace(/\\/g, '/');
  const seg = p.split('/').filter(Boolean);
  const withoutLang = ['ko', 'ja', 'es', 'zh'].includes(seg[0]) ? seg.slice(1) : seg;
  if (withoutLang[0] === 'index.html') return true; // home, per language
  return ['regions', 'destinations', 'continents', 'events', 'essentials'].includes(withoutLang[0]);
};

function* pages(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* pages(p);
    else if (e.name === 'index.html') yield p;
  }
}

const byUrl = new Map(); // url → sample page paths
for (const file of pages(DIST)) {
  const rel = file.slice(DIST.length + 1);
  if (!ALL && !isHubPath(rel)) continue;
  const html = readFileSync(file, 'utf8');
  const url = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
  if (!url) continue;
  if (!byUrl.has(url)) byUrl.set(url, []);
  byUrl.get(url).push(rel);
}

console.log(`probing ${byUrl.size} distinct og:image(s) from ${ALL ? 'all pages' : 'home + hubs'}…`);
requireExamined(byUrl.size, '공유 이미지', 'dist 가 비어 있거나 빌드를 안 돌렸다');

const narrow = [];
const unmeasured = [];
for (const [url, users] of byUrl) {
  // Local files (the brand default) can be measured without the network.
  let width = null;
  const localPath = url.startsWith('https://wanderatlasguides.com/')
    ? join('public', url.replace('https://wanderatlasguides.com/', ''))
    : null;
  if (localPath && existsSync(localPath) && statSync(localPath).isFile()) {
    const { parseImageWidth } = await import('./lib/image-width.mjs');
    width = parseImageWidth(readFileSync(localPath));
  } else {
    width = await probeWidth(url);
  }
  if (width == null) { unmeasured.push({ url, users, local: !!localPath }); continue; }
  if (width < MIN_WIDTH) narrow.push({ url, width, users });
}

narrow.sort((a, b) => b.users.length - a.users.length);
for (const n of narrow) {
  console.log(`❌ ${n.width}px — ${n.users.length} page(s) — ${n.url}`);
  n.users.slice(0, 3).forEach((u) => console.log(`      ${u}`));
}
const unknown = unmeasured.length;
console.log(`\n📋 ${byUrl.size} image(s): ${narrow.length} under ${MIN_WIDTH}px, ${unknown} unmeasurable`);

// An alarm that says "could not measure" and stops there sends a person back to
// the network with a script of their own. Name the hosts and a few URLs, so the
// next reader can tell a blocked user agent from a URL that 404s (2026-09-08:
// 460 of 462 unmeasurable, and finding out why meant re-instrumenting by hand).
if (unknown) {
  const byHost = new Map();
  for (const u of unmeasured) {
    let host;
    try { host = new URL(u.url).host; } catch { host = '(unparseable URL)'; }
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(u);
  }
  console.log('못 잰 것의 출처:');
  for (const [host, list] of [...byHost.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`   ${String(list.length).padStart(4)} × ${host}`);
    for (const u of list.slice(0, 2)) console.log(`        ${u.url}${u.local ? ' (our own path — file missing under public/?)' : ''}`);
  }
}
if (narrow.length) process.exit(1);

// "못 잰 것"은 "괜찮은 것"이 아니다. 2026-09-08 실행: 24개 중 23개를 재지 못했는데
// ✅ 를 찍었다 — 이미지 CDN 이 우리 UA 를 막으면 전부 unmeasurable 이 되고, 그때
// 이 검사는 아무것도 보지 않은 채 통과를 보고한다. 같은 착오로 멀쩡한 사진 24건이
// 영구 기각된 적이 있다([[image-fetch-ua-and-unmeasured-verdicts]]).
if (unknown > byUrl.size / 2) {
  console.log(`OG-WIDTH: ${unknown} of ${byUrl.size} share image(s) could not be measured — this run checked almost nothing.`);
  console.log('Not a pass. Check whether the image host is refusing this user agent.');
  process.exit(1);
}
console.log(`✅ every share image clears the Discover large-card floor${unknown ? ` (${unknown} unmeasurable)` : ''}.`);
