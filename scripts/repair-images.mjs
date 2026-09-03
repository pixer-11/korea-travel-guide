#!/usr/bin/env node

// ⚠️ NO VISION GATE — 2026-08-01 감사 지적, 08-04 차단.
// 정규 사진 경로(generate.mjs · backfill-photos-alt.mjs · discover-events.mjs)는
// 전부 fail-closed vision 게이트를 거치지만 이 도구는 예외다. 어떤 워크플로에도
// 연결돼 있지 않은 채 남아 있어서, 수동으로 한 번 돌리면 지금까지 격리한 오사진을
// 검증 없이 되살릴 수 있었다. 의도적으로만 실행되도록 막는다.
if (process.env.I_KNOW_NO_VISION !== '1') {
  console.error('');
  console.error('⛔ 이 스크립트는 AI 시각검증 없이 대표사진을 씁니다.');
  console.error('   잘못된 사진이 그대로 발행될 수 있어 기본 차단돼 있습니다.');
  console.error('   정상 경로: 매일 04:35 alt-photos 순찰(비전 게이트 포함).');
  console.error('   그래도 실행하려면 I_KNOW_NO_VISION=1 을 붙이세요.');
  console.error('');
  process.exit(1);
}

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
import { markUsedImage } from './lib/hero-url.mjs';

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
      markUsedImage(used, img.url);
      console.log(`  =  SAME  ${label} [${img.license}]`);
      continue;
    }

    markUsedImage(used, img.url);
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
