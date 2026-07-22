#!/usr/bin/env node
// Re-resolve heroes for a few posts that shared the same Unsplash photo with
// another post, so each ends up with a unique, fitting image. Local (Commons/
// Unsplash). CRLF-safe line edit of the heroImage block.
import './lib/env.mjs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveHero } from './lib/images.mjs';
import { isImageAllowed } from './lib/guardrails.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'content', 'posts');
const TARGETS = ['busan-jeonpo-cafe-street'];

const f = (src, k) => (src.match(new RegExp(`^${k}:\\s*"?([^"\\r\\n]+?)"?\\s*$`, 'm')) || [])[1]?.trim() || null;
const heroUrl = (src) => (src.match(/heroImage:\r?\n {2}url:\s*"?([^"\r\n]+?)"?\s*$/m) || [])[1]?.trim() || null;
const unsplashId = (u) => (u && u.match(/photo-([0-9a-zA-Z_-]+)/) || [])[1] || null;

// Seed `used` from every OTHER post's hero (url + unsplash photo-id) to avoid any dup.
const used = new Set();
for (const file of (await readdir(DIR)).filter((x) => x.endsWith('.md'))) {
  if (TARGETS.includes(file.replace(/\.md$/, ''))) continue;
  const u = heroUrl(await readFile(join(DIR, file), 'utf8'));
  if (u) { used.add(u); const id = unsplashId(u); if (id) used.add(`unsplash:${id}`); }
}

for (const slug of TARGETS) {
  const p = join(DIR, `${slug}.md`);
  const src = await readFile(p, 'utf8');
  const region = f(src, 'region');
  const country = f(src, 'country') || 'South Korea';
  const tags = [...src.matchAll(/^\s*-\s*"?([^"\r\n]+?)"?\s*$/gm)].map((m) => m[1].trim());
  const topic = tags[1] || tags[0] || null;
  const nameM = src.match(/\n {2}name:\s*"?([^"\r\n]+?)"?\s*$/m);
  const namedVenue = nameM ? nameM[1].trim() : null;

  const hero = await resolveHero({ namedVenue, region, topic, country, used });
  if (!hero || hero.license === 'placeholder' || !isImageAllowed(hero)) { console.log(`  ✗ no better image: ${slug}`); continue; }
  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  const block = `heroImage:${nl}  url: ${JSON.stringify(hero.url)}${nl}  credit: ${JSON.stringify(hero.credit)}${nl}  license: ${JSON.stringify(hero.license)}${nl}  source: ${JSON.stringify(hero.source)}`;
  const next = src.replace(/heroImage:\r?\n {2}url:.*\r?\n {2}credit:.*\r?\n {2}license:.*\r?\n {2}source:.*/, block);
  if (next === src) { console.log(`  ⚠️ no heroImage block: ${slug}`); continue; }
  await writeFile(p, next, 'utf8');
  const id = unsplashId(hero.url); if (id) used.add(`unsplash:${id}`); used.add(hero.url);
  console.log(`  ✅ ${slug} → ${hero.license}: ${hero.url.slice(0, 66)}`);
}
