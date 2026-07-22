#!/usr/bin/env node
// One-off maintenance: find posts whose hero fell back to the placeholder SVG
// (happens when image lookup failed mid-run, e.g. Unsplash rate-limiting during a
// big backfill) and re-resolve a real hero via the normal resolver. Safe to re-run.
import './lib/env.mjs'; // loads UNSPLASH_ACCESS_KEY etc. before images.mjs reads env
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveHero } from './lib/images.mjs';
import { isImageAllowed } from './lib/guardrails.mjs';

const POSTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'content', 'posts');

const field = (src, name) => {
  const m = src.match(new RegExp(`^${name}:\\s*"?([^"\\n]+?)"?\\s*$`, 'm'));
  return m ? m[1].trim() : null;
};

// All non-placeholder hero URLs already in use → avoid duplicate photos.
async function usedUrls() {
  const urls = new Set();
  for (const f of await readdir(POSTS_DIR)) {
    if (!f.endsWith('.md')) continue;
    const m = (await readFile(join(POSTS_DIR, f), 'utf8')).match(/\n {2}url:\s*"?([^"\n]+?)"?\s*$/m);
    if (m && !m[1].includes('placeholder')) urls.add(m[1].trim());
  }
  return urls;
}

const used = await usedUrls();
let fixed = 0, failed = 0;
for (const f of (await readdir(POSTS_DIR)).filter((x) => x.endsWith('.md'))) {
  const path = join(POSTS_DIR, f);
  const src = await readFile(path, 'utf8');
  if (!src.includes('/images/placeholder-market.svg')) continue;

  const region = field(src, 'region');
  const country = field(src, 'country') || 'South Korea';
  // topic = 2nd tag (tags are [region-lower, topic]); place.name if present.
  const tagItems = [...src.matchAll(/^\s*-\s*"?([^"\n]+?)"?\s*$/gm)].map((m) => m[1].trim());
  const topic = tagItems[1] || tagItems[0] || null;
  const nameM = src.match(/\n {2}name:\s*"?([^"\n]+?)"?\s*$/m);
  const namedVenue = nameM ? nameM[1].trim() : null;

  const hero = await resolveHero({ namedVenue, region, topic, country, used });
  if (!hero || hero.license === 'placeholder' || !isImageAllowed(hero)) {
    console.log(`  ✗ still none: ${f} (${region}, ${country}, topic=${topic})`);
    failed++;
    continue;
  }
  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  const block =
    `heroImage:${nl}  url: ${JSON.stringify(hero.url)}${nl}  credit: ${JSON.stringify(hero.credit)}${nl}` +
    `  license: ${JSON.stringify(hero.license)}${nl}  source: ${JSON.stringify(hero.source)}`;
  const next = src.replace(/heroImage:\r?\n {2}url:.*\r?\n {2}credit:.*\r?\n {2}license:.*\r?\n {2}source:.*/, block);
  if (next === src) { console.log(`  ⚠️  no heroImage block matched: ${f}`); failed++; continue; }
  await writeFile(path, next, 'utf8');
  used.add(hero.url);
  fixed++;
  console.log(`  ✅ ${f} → ${hero.license}: ${hero.url.slice(0, 72)}`);
}
console.log(`\nDone. Fixed ${fixed}, still-placeholder ${failed}.`);
