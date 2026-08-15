#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  BUILD HERO PHOTO-WALL THUMBNAILS
//  Downloads each post's hero image once, resizes to a light 640px WebP, and
//  self-hosts it in public/wall/ + writes data/wall.json. The homepage photo
//  wall then serves these tiny local files (no giant remote originals, no
//  build-time remote fetch → fast + reliable, no Wikimedia 429 during deploy).
//
//  Idempotent: skips images already built, so daily CI only fetches the new
//  ones. Polite: small delay between downloads to avoid rate limits.
//  Usage:  node scripts/build-wall.mjs
// ─────────────────────────────────────────────────────────────
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const POSTS_DIR = join(ROOT, 'src', 'content', 'posts');
const OUT_DIR = join(ROOT, 'public', 'wall');
const MANIFEST = join(ROOT, 'data', 'wall.json');
const UA = 'WanderAtlasBot/1.0 (https://wanderatlasguides.com; travel guide) build-wall';

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function heroUrls() {
  const files = (await readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'));
  const urls = new Map();
  for (const f of files) {
    const raw = (await readFile(join(POSTS_DIR, f), 'utf8')).replace(/\r\n/g, '\n');
    const fm = raw.match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
    // Skip QUARANTINED posts. This read every .md in the directory, so a post
    // pulled for having the wrong photo lost its article and kept its picture:
    // 67 of 653 wall thumbnails came from drafts, and 26 of those were images
    // the site's own vision gate had already judged MISMATCH — "This is Fuglen
    // in Oslo, Norway, not Tokyo", "Image shows Sorrento coast, not Naples".
    // The homepage shuffle then drew 12 tiles a day from a pool that was 10%
    // material we had decided was wrong.
    if (/^draft:\s*true\s*$/m.test(fm)) continue;
    // Parsed, not pattern-matched. The old regex required the URL to sit on the
    // SAME line as `url:`, and YAML folds a long value onto the next line
    // instead ("url: >-\n    https://…"). Every post whose hero URL was long
    // enough to fold was therefore invisible to this script — 40 live posts on
    // 2026-08-11, each one reported by the validator as a blank card while this
    // script insisted there was nothing to build. A frontmatter reader that
    // only understands one of YAML's spellings will always drift from the one
    // Astro actually parses.
    let url, focus;
    try { const h = yaml.load(fm)?.heroImage; url = h?.url; focus = h?.focus; } catch { url = undefined; }
    url = url == null ? undefined : String(url).trim();
    // Accept remote (http) heroes AND self-hosted local ones (/venue-photos/…).
    if (url && (/^https?:/.test(url) || url.startsWith('/')) && !url.includes('placeholder')) {
      // Same URL on two posts (never, by dedup — but defensively): first
      // stored focal point wins.
      if (!urls.has(url)) urls.set(url, focus && Number.isFinite(focus.x) && Number.isFinite(focus.y) ? focus : null);
    }
  }
  return [...urls.entries()].map(([url, focus]) => ({ url, focus }));
}

async function main() {
  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });
  const urls = await heroUrls();
  console.log(`\n🖼️  Wall pool: ${urls.length} source images\n`);

  const manifest = [];
  let made = 0, cached = 0, failed = 0;
  for (const { url, focus } of urls) {
    // The thumb's name carries the focal point, so a hero that GAINS a stored
    // focus (the vision gate now reports one) is re-cut instead of served
    // from the old centre/attention crop forever.
    const name = `${hash(focus ? `${url}#${focus.x},${focus.y}` : url)}.webp`;
    const outPath = join(OUT_DIR, name);
    const publicPath = `/wall/${name}`;
    if (existsSync(outPath)) { manifest.push(publicPath); cached++; continue; }
    try {
      let buf;
      if (url.startsWith('/')) {
        // Self-hosted venue photo — read straight from disk (no fetch).
        const localPath = join(ROOT, 'public', url.replace(/^\/+/, ''));
        if (!existsSync(localPath)) throw new Error('local file missing');
        buf = await readFile(localPath);
      } else {
        const res = await fetch(url, { headers: { 'User-Agent': UA } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buf = Buffer.from(await res.arrayBuffer());
      }
      // Crop toward the SUBJECT. sharp's 'attention' heuristic follows
      // saturation and edges — on Bruno Mars' stage shot that was the neon
      // "Doo-Wops & Hooligans" sign, and the card showed a suit with no head
      // (owner, 2026-08-15). Order of trust: the vision gate's stored focal
      // point (it looked at the picture and said where the face is) → for a
      // portrait with no stored point, the top (faces live in the top third)
      // → 'attention' only for landscapes, where it does fine.
      const img = sharp(buf);
      const meta = await img.metadata();
      let position = 'attention';
      if (focus) {
        // sharp has no fractional gravity; map the point to the nearest of
        // its 8 compass positions + centre. Good enough for a 640×427 card.
        const v = focus.y < 33 ? 'top' : focus.y > 66 ? 'bottom' : '';
        const h = focus.x < 33 ? 'left' : focus.x > 66 ? 'right' : '';
        position = [h, v].filter(Boolean).join(' ') || 'centre'; // sharp accepts 'left top', 'top', 'right', …
      } else if (meta.height && meta.width && meta.height > meta.width) {
        position = 'top';
      }
      await img
        .resize(640, 427, { fit: 'cover', position })
        .webp({ quality: 72 })
        .toFile(outPath);
      manifest.push(publicPath);
      made++;
      console.log(`  ✓ ${name}`);
      if (!url.startsWith('/')) await sleep(350); // be polite to remote hosts only
    } catch (e) {
      failed++;
      console.log(`  ⚠️  ${url.slice(0, 64)} — ${e.message}`);
    }
  }

  await writeFile(MANIFEST, JSON.stringify({ images: manifest }, null, 2) + '\n', 'utf8');
  console.log(`\n📦  ${made} made · ${cached} cached · ${failed} failed → ${manifest.length} in manifest\n`);

  // Sweep abandoned thumbs in the same pass that creates new ones. Each file is
  // named sha1(heroUrl), so every photo swap mints one and orphans another, and
  // nothing ever collected them: 614 unreachable thumbs (24 MB) had piled up by
  // 2026-08-04 — more than half of everything being deployed. Running it here
  // rather than in the seven workflows that call this script stops the two
  // halves of one job from drifting apart.
  await import('./prune-wall-thumbs.mjs');
}

main().catch((e) => { console.error(e); process.exit(1); });
