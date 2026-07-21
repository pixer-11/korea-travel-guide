#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  REPAIR HERO IMAGES
//  Re-resolves every existing post's hero image with the accurate-first
//  waterfall (Wikimedia Commons by venue name → Places → Wikimedia by
//  topic+region → Korea-scoped Unsplash). Fixes wrong-country / mismatched
//  stock photos (e.g. a Versailles photo on a Gyeongbokgung post).
//
//  SAFE: if no better/accurate source is found (or Unsplash is rate-limited),
//  the existing image is KEPT — the script never downgrades a post.
//  Idempotent & resumable: re-run later to fix any that were skipped.
//
//  Usage:
//    node scripts/repair-images.mjs            # all posts
//    node scripts/repair-images.mjs seoul      # only slugs containing "seoul"
//    DRY=1 node scripts/repair-images.mjs      # report only, write nothing
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveHero } from './lib/images.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = join(__dirname, '..', 'src', 'content', 'posts');
const DRY = process.env.DRY === '1';
const FILTER = process.argv[2] || '';
// Stop calling Unsplash after this many uses to respect the free 50/hour limit.
const UNSPLASH_BUDGET = Number(process.env.UNSPLASH_BUDGET ?? 40);

const q = (s) => JSON.stringify(String(s));
const field = (fm, key) => {
  const m = fm.match(new RegExp(`^${key}:\\s*"?([^"\\n]+?)"?\\s*$`, 'm'));
  return m ? m[1] : '';
};
// place.name lives indented under `place:`; hero has no name field.
const placeName = (fm) => {
  const m = fm.match(/\nplace:\n(?:  .*\n)*?  name:\s*"?([^"\n]+?)"?\s*$/m);
  return m ? m[1] : '';
};
// tags: [region, topic] — topic is the 2nd list item.
const topicTag = (fm) => {
  const block = fm.match(/\ntags:\n((?:  - .*\n)+)/);
  if (!block) return '';
  const items = [...block[1].matchAll(/  - "?([^"\n]+?)"?\s*$/gm)].map((x) => x[1]);
  return items[1] || items[0] || '';
};
const heroUrl = (fm) => {
  const m = fm.match(/\nheroImage:\n(?:  .*\n)*?  url:\s*"?([^"\n]+?)"?\s*$/m);
  return m ? m[1] : '';
};

function heroYaml(img) {
  return (
    `heroImage:\n` +
    `  url: ${q(img.url)}\n` +
    `  credit: ${q(img.credit)}\n` +
    `  license: ${q(img.license)}\n` +
    `  source: ${q(img.source)}\n`
  );
}

async function main() {
  const files = (await readdir(POSTS_DIR))
    .filter((f) => f.endsWith('.md'))
    .filter((f) => !FILTER || f.includes(FILTER));

  console.log(`\n🖼️  Repairing hero images — ${files.length} post(s)${DRY ? ' (DRY RUN)' : ''}\n`);

  const used = new Set();
  let changed = 0, same = 0, kept = 0, unsplashUsed = 0;

  for (const file of files) {
    const path = join(POSTS_DIR, file);
    // Normalize CRLF → LF so parsing works regardless of who wrote the file
    // (bot commits from GitHub Actions arrive as CRLF on checkout).
    const raw = (await readFile(path, 'utf8')).replace(/\r\n/g, '\n');
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) { console.log(`  ?  ${file} — no frontmatter, skipped`); continue; }
    const fm = fmMatch[1];

    const region = field(fm, 'region');
    const topic = topicTag(fm);
    const venue = placeName(fm); // '' for placeless posts
    const oldUrl = heroUrl(fm);

    const img = await resolveHero({
      namedVenue: venue || null,
      region,
      topic,
      used,
      allowUnsplash: unsplashUsed < UNSPLASH_BUDGET,
    });

    const label = venue || `${topic} · ${region}`;

    if (!img || img.license === 'placeholder') {
      kept++;
      console.log(`  ⏸  KEEP  ${label} — no accurate source found (kept existing)`);
      continue;
    }
    if (img.license === 'unsplash') unsplashUsed++;

    if (img.url === oldUrl) {
      same++;
      used.add(img.url);
      console.log(`  =  SAME  ${label} [${img.license}]`);
      continue;
    }

    used.add(img.url);
    if (!/\nheroImage:\n/.test(raw)) {
      console.log(`  ?  ${file} — no heroImage block to replace, skipped`);
      continue;
    }
    const next = raw.replace(/heroImage:\n(?:  .*\n)*/, heroYaml(img));
    if (!DRY) await writeFile(path, next, 'utf8');
    changed++;
    console.log(`  ✅ FIX   ${label} → [${img.license}] ${img.credit.slice(0, 48)}`);
  }

  console.log(
    `\n📦  Done. ${changed} fixed · ${same} already-correct · ${kept} kept` +
    ` · Unsplash used ${unsplashUsed}/${UNSPLASH_BUDGET}${DRY ? ' (DRY — nothing written)' : ''}\n`
  );
  if (unsplashUsed >= UNSPLASH_BUDGET) {
    console.log('⚠️  Hit Unsplash budget — re-run in ~1h to finish any KEEP posts.\n');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
