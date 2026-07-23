// One-off + reusable cleanup: give every post a REAL, UNIQUE hero image.
// Fixes two things the discover-events batch introduced:
//   1) placeholder heroes (event/venue photos that never resolved), and
//   2) the same Unsplash photo re-used across posts (URL-param differences hid it
//      from the old URL-only de-dupe; we now key on the photo's numeric id).
// For each target we re-run resolveHero with a `used` Set seeded from EVERY post's
// current image, so the new pick is guaranteed distinct site-wide.
//
//   node --env-file=.env scripts/reresolve-images.mjs           # dry-run
//   node --env-file=.env scripts/reresolve-images.mjs --apply   # write files
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveHero, unsplashNum } from './lib/images.mjs';

const DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const APPLY = process.argv.includes('--apply');

// Keep the most place-identifying post on a shared image; re-resolve the rest.
const KEEP_RANK = { attraction: 0, 'hidden-gem': 1, trendy: 2, restaurant: 3, event: 4 };

const files = (await readdir(DIR)).filter((f) => f.endsWith('.md'));
const posts = [];
for (const f of files) {
  const t = await readFile(join(DIR, f), 'utf8');
  const fm = t.slice(0, t.indexOf('\n---', 3));
  const get = (k) => (fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1] || '').trim().replace(/^["']|["']$/g, '');
  const heroBlock = fm.split(/^heroImage:/m)[1] || '';
  const url = (heroBlock.match(/^\s+url:\s*(.+)$/m)?.[1] || '').trim();
  posts.push({ f, region: get('region'), country: get('country'), category: get('category'), url, t });
}

// Seed the site-wide used set from all current images.
const used = new Set();
for (const p of posts) {
  if (!p.url || p.url.includes('placeholder')) continue;
  used.add(p.url);
  const n = unsplashNum(p.url);
  if (n) used.add(n);
}

// Targets: placeholders + all-but-one of each duplicate group.
const targets = [];
const groups = new Map();
for (const p of posts) {
  if (!p.url || p.url.includes('placeholder')) { targets.push(p); continue; }
  const key = unsplashNum(p.url) || p.url;
  (groups.get(key) || groups.set(key, []).get(key)).push(p);
}
for (const [, ps] of groups) {
  if (ps.length < 2) continue;
  ps.sort((a, b) => (KEEP_RANK[a.category] ?? 9) - (KEEP_RANK[b.category] ?? 9));
  targets.push(...ps.slice(1)); // keep ps[0], re-resolve the rest
}

console.log(`${targets.length} target(s) to re-resolve (${APPLY ? 'APPLY' : 'dry-run'})\n`);
let done = 0, failed = 0;
for (const p of targets) {
  // Drop this post's own current image from `used` so it isn't blocked by itself.
  if (p.url) { used.delete(p.url); const n = unsplashNum(p.url); if (n) used.delete(n); }
  const hero = await resolveHero({
    namedVenue: null, region: p.region, topic: null, country: p.country || 'South Korea',
    used, allowUnsplash: true, selfHost: false,
  });
  if (!hero?.url || hero.url.includes('placeholder')) {
    failed++; console.log(`  ✗ ${p.region}, ${p.country}  (${p.f}) — no image found`);
    continue;
  }
  done++;
  console.log(`  ✓ [${p.category}] ${p.region} → ${hero.url.slice(0, 62)}…`);
  if (APPLY) {
    const block = `heroImage:\n  url: ${JSON.stringify(hero.url)}\n  credit: ${JSON.stringify(hero.credit)}\n  license: ${JSON.stringify(hero.license)}\n  source: ${JSON.stringify(hero.source)}`;
    const out = p.t.replace(/^heroImage:[\s\S]*?(?=\ngallery:)/m, block);
    if (out !== p.t) await writeFile(join(DIR, p.f), out, 'utf8');
  }
}
console.log(`\n${done} resolved, ${failed} failed.`);
