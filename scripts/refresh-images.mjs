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

// One-off: re-fetch hero images for existing placeless posts using region +
// "South Korea" queries AND de-duplicating across posts, so photos are both
// relevant to Korea and not repeated. Safe to re-run.
import './lib/env.mjs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { unsplashCandidates, trackUnsplashDownload } from './lib/images.mjs';

const POSTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'content', 'posts');

const files = (await readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'));
const used = new Set(); // photo ids already assigned this run
let updated = 0;

for (const file of files) {
  const full = join(POSTS_DIR, file);
  const parsed = matter(await readFile(full, 'utf8'));
  const d = parsed.data;
  if (d.place) continue; // real venue — leave it
  const region = d.region;
  const topic = Array.isArray(d.tags) ? d.tags[1] : null;
  if (!region || !topic) continue;

  // Try queries from specific → broad; pick the first photo not already used.
  const queries = [
    `${topic} ${region} South Korea`,
    `${region} South Korea`,
    `South Korea travel`,
  ];
  let chosen = null;
  for (const q of queries) {
    const cands = await unsplashCandidates(q, 30);
    chosen = cands.find((c) => !used.has(c.id));
    if (chosen) break;
  }

  if (chosen) {
    used.add(chosen.id);
    trackUnsplashDownload(chosen.downloadLocation);
    d.heroImage = { url: chosen.url, credit: chosen.credit, license: chosen.license, source: chosen.source };
    await writeFile(full, matter.stringify(parsed.content, d), 'utf8');
    updated++;
    console.log(`  ✅  ${file}`);
  } else {
    console.log(`  ⏭️   ${file} (kept)`);
  }
}
console.log(`\n📦  Refreshed ${updated} hero images (${used.size} unique photos).\n`);
