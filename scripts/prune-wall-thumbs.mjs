#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  WALL THUMB PRUNE — deletes self-hosted 640px thumbs no post points at.
//
//  build-wall.mjs names each thumb sha1(heroUrl), so every hero swap — a photo
//  patrol replacement, a resolution change, a tracking query stripped off the
//  URL — mints a new file and abandons the old one. Nothing ever removed them:
//  by 2026-08-04 the repo carried 1,288 thumbs for 636 live cards, so more than
//  half of what shipped to Cloudflare was unreachable.
//
//  DRAFTS ARE KEPT. A quarantined post is waiting for the alt-photo patrol and
//  goes back up with the same hero if the photo turns out to be fine; deleting
//  its thumb would just make the next build re-download and re-encode it. Only
//  files no post references AT ALL — live or drafted — are removed.
//
//  Env: DRY=1 (report only). Usage: node scripts/prune-wall-thumbs.mjs
// ─────────────────────────────────────────────────────────────
import { readdir, readFile, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import matter from 'gray-matter';

const POSTS = 'src/content/posts';
const WALL = 'public/wall';
const DRY = process.env.DRY === '1';

const keep = new Set();
const add = (url) => { if (url && !String(url).includes('placeholder')) keep.add(createHash('sha1').update(String(url)).digest('hex').slice(0, 16) + '.webp'); };

for (const f of (await readdir(POSTS)).filter((x) => x.endsWith('.md'))) {
  const { data } = matter(await readFile(join(POSTS, f), 'utf8'));
  add(data.heroImage?.url);                       // drafts included, on purpose
  for (const g of data.gallery ?? []) add(g?.url);
}

const files = (await readdir(WALL)).filter((f) => f.endsWith('.webp'));
const orphans = files.filter((f) => !keep.has(f));
let bytes = 0;
for (const f of orphans) {
  bytes += (await stat(join(WALL, f))).size;
  if (!DRY) await unlink(join(WALL, f));
}

console.log(`🧹 wall thumbs: ${files.length} on disk · ${keep.size} referenced · ${orphans.length} orphaned (${(bytes / 1e6).toFixed(1)} MB)${DRY ? ' — DRY, nothing deleted' : ' removed'}`);
console.log(`WALL_PRUNE_SUMMARY on_disk=${files.length} referenced=${keep.size} pruned=${orphans.length} bytes=${bytes}`);
