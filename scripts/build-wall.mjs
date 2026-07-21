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
  const urls = new Set();
  for (const f of files) {
    const raw = (await readFile(join(POSTS_DIR, f), 'utf8')).replace(/\r\n/g, '\n');
    const fm = raw.match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
    const url = fm.match(/heroImage:\n(?:  .*\n)*?  url:\s*"?([^"\n]+?)"?\s*$/m)?.[1];
    if (url && /^https?:/.test(url) && !url.includes('placeholder')) urls.add(url);
  }
  return [...urls];
}

async function main() {
  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });
  const urls = await heroUrls();
  console.log(`\n🖼️  Wall pool: ${urls.length} source images\n`);

  const manifest = [];
  let made = 0, cached = 0, failed = 0;
  for (const url of urls) {
    const name = `${hash(url)}.webp`;
    const outPath = join(OUT_DIR, name);
    const publicPath = `/wall/${name}`;
    if (existsSync(outPath)) { manifest.push(publicPath); cached++; continue; }
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await sharp(buf)
        .resize(640, 427, { fit: 'cover', position: 'attention' })
        .webp({ quality: 72 })
        .toFile(outPath);
      manifest.push(publicPath);
      made++;
      console.log(`  ✓ ${name}`);
      await sleep(350); // be polite → avoid Wikimedia 429
    } catch (e) {
      failed++;
      console.log(`  ⚠️  ${url.slice(0, 64)} — ${e.message}`);
    }
  }

  await writeFile(MANIFEST, JSON.stringify({ images: manifest }, null, 2) + '\n', 'utf8');
  console.log(`\n📦  ${made} made · ${cached} cached · ${failed} failed → ${manifest.length} in manifest\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
