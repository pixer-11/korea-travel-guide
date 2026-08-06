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

const DIST = 'dist';
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

const narrow = [];
let unknown = 0;
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
  if (width == null) { unknown++; continue; }
  if (width < MIN_WIDTH) narrow.push({ url, width, users });
}

narrow.sort((a, b) => b.users.length - a.users.length);
for (const n of narrow) {
  console.log(`❌ ${n.width}px — ${n.users.length} page(s) — ${n.url}`);
  n.users.slice(0, 3).forEach((u) => console.log(`      ${u}`));
}
console.log(`\n📋 ${byUrl.size} image(s): ${narrow.length} under ${MIN_WIDTH}px, ${unknown} unmeasurable`);
if (narrow.length) process.exit(1);
console.log('✅ every share image clears the Discover large-card floor.');
