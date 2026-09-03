#!/usr/bin/env node
//
// Two posts wearing the same hero photo: give one of them a different, verified
// image. The reader who lands on both sees two events, not one page twice.
//
// 2026-08-19. `loadUsedImageUrls` — the set that is supposed to stop this —
// read the hero with a regex that missed folded scalars and any post whose
// officialLink sat above heroImage, so ~113 heroes were invisible to it and
// Taiyuan + Wuhan ended up sharing one snooker table. hero-url.mjs fixes the
// blind spot going forward; this cleans up what got through, and stays wired
// into the nightly photo patrol so the next pair is fixed without being asked.
//
// Rules it obeys (each one has a scar behind it):
//   • VISION-GATED. Every replacement passes verifyHeroImage, same as the
//     regular photo paths. cf. reresolve-dupe-photos.mjs, which had no gate and
//     is blocked behind an env flag for exactly that reason.
//   • Wikimedia/Unsplash only — no Foursquare credits, no Google Places
//     (Vietnam billing block).
//   • NOTHING IS DELETED and nothing is drafted. A post that cannot find a
//     replacement keeps the photo it has: a shared photo is a blemish, an
//     unpublished post is lost traffic (2026-07-26, 92 posts, −40%).
import './lib/env.mjs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { heroUrlOf, imageIdentity, isUsedImage, markUsedImage, heroKeeper } from './lib/hero-url.mjs';
import { resolveHero, eventTopic } from './lib/images.mjs';
import { isImageAllowed } from './lib/guardrails.mjs';
import { verifyHeroImage } from './lib/vision-check.mjs';
import { eventProperName } from '../src/lib/eventName.mjs';

const DIR = join('src', 'content', 'posts');
const DRY = process.argv.includes('--dry');
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || 6);

const isPlaceholder = (u) => !u || u.startsWith('/images/placeholder');

/** Swap the hero block's source fields, keeping any other keys (alt, …) intact. */
function replaceHeroBlock(src, hero) {
  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  const start = lines.findIndex((l) => /^heroImage:\s*$/.test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^\S/.test(lines[end]) && lines[end].trim() !== '') end++;

  // Drop the fields we are replacing (and any folded/nested continuation of
  // them — `url: >-` puts the value on the next, deeper-indented line).
  const REPLACED = /^ {2}(url|credit|license|source|focus):/;
  const kept = [];
  for (let i = start + 1; i < end; i++) {
    if (REPLACED.test(lines[i])) {
      while (i + 1 < end && /^ {3,}/.test(lines[i + 1])) i++;
      continue;
    }
    kept.push(lines[i]);
  }
  const block = ['heroImage:', `  url: ${JSON.stringify(hero.url)}`];
  if (hero.credit) block.push(`  credit: ${JSON.stringify(hero.credit)}`);
  if (hero.license) block.push(`  license: ${JSON.stringify(hero.license)}`);
  if (hero.source) block.push(`  source: ${JSON.stringify(hero.source)}`);
  lines.splice(start, end - start, ...block, ...kept);
  return lines.join(nl);
}

const files = (await readdir(DIR)).filter((f) => f.endsWith('.md'));
const posts = [];
const used = new Set();
for (const f of files) {
  const src = await readFile(join(DIR, f), 'utf8');
  const url = heroUrlOf(src);
  const { data } = matter(src);
  posts.push({ f, slug: f.replace(/\.md$/, ''), url, data });
  markUsedImage(used, url);
}

// Group by PHOTO, not by URL string: the same Commons file at another width
// or host is the same picture (two tour cities shared one portrait for weeks
// under two spellings, 2026-09-03). Placeholders are shared on purpose.
const groups = new Map();
for (const p of posts) {
  if (isPlaceholder(p.url)) continue;
  const key = imageIdentity(p.url);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(p);
}
const dupes = [...groups.values()].filter((g) => g.length > 1);
if (!dupes.length) {
  console.log('✓ no duplicate hero photos');
  process.exit(0);
}

// The earliest post keeps the photo it has been wearing; later ones re-resolve.
const targets = [];
for (const g of dupes) {
  const keeper = heroKeeper(g.map((p) => ({ slug: p.slug, pubDate: p.data.pubDate })));
  const sorted = [...g].sort((a, b) => (a.slug === keeper.slug ? -1 : b.slug === keeper.slug ? 1 : a.slug.localeCompare(b.slug)));
  console.log(`\n⧉ ${sorted.length} posts share ${sorted[0].url.slice(0, 70)}`);
  console.log(`   keeps it: ${sorted[0].slug}`);
  targets.push(...sorted.slice(1));
}

let fixed = 0, unfixed = 0;
for (const t of targets.slice(0, LIMIT)) {
  const { data, slug } = t;
  const isEvent = data.category === 'event';
  const venueName = data.place?.name || eventProperName(data.title) || data.title;
  const seen = new Set(used); // its current (shared) hero is in here — so it won't come back

  // Topic from the venue name AND the title: eventProperName trims
  // "2026 Wuhan Open (Snooker)" down to "Wuhan Open", and the sport — the one
  // word that finds a fitting photo — falls off with it, leaving eventTopic to
  // guess "concert stage". Vision still has the final say on whatever comes back.
  let picked = null;
  for (let i = 0; i < 6 && !picked; i++) {
    let cand = null;
    try {
      cand = await resolveHero({
        namedVenue: venueName, region: data.region, topic: isEvent ? eventTopic(`${venueName} ${data.title}`) : (data.tags?.[1] || data.category),
        country: data.country, used: seen,
        preferTopic: isEvent, eventMode: isEvent, allowUnsplash: !isEvent,
      });
    } catch {}
    if (!cand?.url || cand.license === 'placeholder') break; // pool exhausted
    if (isUsedImage(used, cand.url) || !isImageAllowed(cand)) continue; // resolveHero already marked it in `seen`
    const vis = await verifyHeroImage({
      url: cand.url, name: venueName, category: data.category,
      region: data.region, country: data.country, eventMode: isEvent,
    });
    if (vis?.ok) picked = cand;
    else console.log(`   ${slug}: candidate failed vision — ${vis?.reason || 'no verdict'}`);
  }

  if (!picked) {
    unfixed++;
    console.log(`  ⚠️  ${slug}: no verified replacement — keeps its current photo`);
    continue;
  }
  const path = join(DIR, t.f);
  const src = await readFile(path, 'utf8');
  const next = replaceHeroBlock(src, picked);
  if (!next) { unfixed++; console.log(`  ⚠️  ${slug}: no heroImage block to replace`); continue; }
  if (DRY) { console.log(`  [dry] ${slug} → ${picked.url}`); continue; }
  await writeFile(path, next, 'utf8');
  // Read it back: the file must now report exactly the hero we wrote.
  const back = heroUrlOf(await readFile(path, 'utf8'));
  if (back !== picked.url) {
    await writeFile(path, src, 'utf8');
    unfixed++;
    console.log(`  ❌ ${slug}: write-back mismatch (${back}) — reverted`);
    continue;
  }
  markUsedImage(used, picked.url);
  fixed++;
  console.log(`  ✅ ${slug}: new hero (${vName(picked)})`);
}
function vName(h) { return String(h.source || h.url).split('/').pop(); }

console.log(`\n${fixed} re-resolved, ${unfixed} left as-is, ${Math.max(0, targets.length - LIMIT)} beyond this run's limit`);
