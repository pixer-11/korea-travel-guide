#!/usr/bin/env node
// One-off: re-fetch hero images for existing placeless posts using a
// region + "South Korea" query, so photos are relevant to Korea (not a
// generic — sometimes wrong-country — stock image). Safe to re-run.
import './lib/env.mjs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { pickImage } from './lib/images.mjs';
import { isImageAllowed } from './lib/guardrails.mjs';

const POSTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'content', 'posts');

const files = (await readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'));
let updated = 0;
for (const file of files) {
  const full = join(POSTS_DIR, file);
  const parsed = matter(await readFile(full, 'utf8'));
  const d = parsed.data;
  if (d.place) continue; // has a real venue — leave it
  const region = d.region;
  const topic = Array.isArray(d.tags) ? d.tags[1] : null;
  if (!region || !topic) continue;

  // Try a specific query, then fall back to a region-level Korea query so we
  // never end up with a wrong-country stock photo.
  let img = await pickImage(null, `${topic} ${region} South Korea`);
  if (img?.license !== 'unsplash') img = await pickImage(null, `${region} South Korea`);
  if (img?.license !== 'unsplash') img = await pickImage(null, `South Korea travel`);
  if (isImageAllowed(img) && img.license === 'unsplash') {
    d.heroImage = img;
    await writeFile(full, matter.stringify(parsed.content, d), 'utf8');
    updated++;
    console.log(`  ✅  ${file} → ${img.credit}`);
  } else {
    console.log(`  ⏭️   ${file} (kept)`);
  }
}
console.log(`\n📦  Refreshed ${updated} hero images.\n`);
