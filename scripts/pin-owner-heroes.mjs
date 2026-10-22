#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  PIN EVERY HERO THE OWNER PHOTOGRAPHED
//
//  A photo 픽서님 took in person (license: editor, served from
//  /editor-photos/) is the strongest identity proof the site has: the
//  photographer stood there. It still went through the machinery built for
//  photos found online — the nightly vision audit re-judged it, and with no
//  verdict on file validate-content warned that it had "never been through the
//  vision check" (bangkok-chinatown-bangkok-yaowarat, 2026-10-22, four days
//  after the owner's photos replaced its hero). A vision MISMATCH there would
//  have let a patrol pull the owner's own photo.
//
//  So the decision is written down the way a hand pick is (lib/hero-pins):
//  pinned, so no patrol or audit changes it, and a MATCH verdict recorded,
//  so the validator reads it as checked. No model call: there is nothing for
//  one to decide. Idempotent; runs in the daily publish before the commit.
//
//    node scripts/pin-owner-heroes.mjs          # pin what is missing
//    DRY=1 node scripts/pin-owner-heroes.mjs    # list only
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { loadHeroPins, saveHeroPins, isPinnedHero, isOwnerPhoto } from './lib/hero-pins.mjs';
import { recordHeroVerdict } from './lib/vision-check.mjs';

const POSTS = 'src/content/posts';
const DRY = process.env.DRY === '1';

const pins = loadHeroPins();
const added = [];
for (const f of readdirSync(POSTS).filter((x) => x.endsWith('.md'))) {
  let data;
  try { ({ data } = matter(readFileSync(join(POSTS, f), 'utf8'))); } catch { continue; }
  const hero = data.heroImage;
  if (!isOwnerPhoto(hero)) continue;
  const slug = f.replace(/\.md$/, '');
  if (isPinnedHero(pins, slug, hero.url)) continue;
  added.push(slug);
  if (DRY) continue;
  pins[slug] = { ...hero, why: 'the owner photographed it in person (editor-original)', at: new Date().toISOString() };
  await recordHeroVerdict(slug, hero.url, 'MATCH', `owner photo: ${String(hero.source || '').slice(0, 120)}`);
}
if (!DRY && added.length) saveHeroPins(pins);
for (const s of added) console.log(`  📌 ${s}`);
console.log(`OWNER_HERO_PINS added=${added.length}${DRY ? ' (dry run)' : ''}`);
