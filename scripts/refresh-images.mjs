#!/usr/bin/env node
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
