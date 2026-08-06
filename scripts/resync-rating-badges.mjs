#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  RATING BADGE RESYNC — the meta description's "4.7★ (706 reviews)" is a
//  snapshot taken the day the post was written. The weekly refresh updates
//  place.rating and place.userRatingsTotal but never re-reads that sentence,
//  so the number drifts from the moment it ships: understated at best, and
//  plainly false once the rating moves (found 2026-08-06, 88 English posts and
//  ~280 translations).
//
//  Rewrites ONLY the figures — in the English description and in every
//  translation of it — then re-stamps each translation's srcHash so a
//  number-only change does not queue 350 pointless re-translations. The
//  re-stamp is gated on differsOnlyInBadge: if the English prose itself moved,
//  the translation is genuinely stale and keeps its old hash so the translator
//  picks it up.
//
//    node scripts/resync-rating-badges.mjs           # write
//    DRY=1 node scripts/resync-rating-badges.mjs     # report only
// ─────────────────────────────────────────────────────────────
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { resyncBadge, readBadge, differsOnlyInBadge } from './lib/rating-badge-sync.mjs';
import { srcHashOf } from './lib/src-hash.mjs';

const POSTS = 'src/content/posts';
const I18N = 'src/content/i18n';
const LANGS = ['ko', 'ja', 'es', 'zh'];
const DRY = process.env.DRY === '1';

let scanned = 0, updated = 0, trUpdated = 0, trStale = 0;
const examples = [];

for (const file of (await readdir(POSTS)).filter((f) => f.endsWith('.md'))) {
  const full = join(POSTS, file);
  let parsed;
  try { parsed = matter(await readFile(full, 'utf8')); } catch { continue; }
  const d = parsed.data;
  if (d.draft) continue;

  const rating = d.place?.rating;
  const total = d.place?.userRatingsTotal;
  const before = String(d.description ?? '');
  if (!readBadge(before)) continue;
  scanned++;

  const after = resyncBadge(before, rating, total);
  if (!after) continue;

  const claimed = readBadge(before);
  if (examples.length < 5) {
    examples.push(`${file}: ${claimed.rating}★/${claimed.total.toLocaleString('en-US')} → ${Number(rating).toFixed(1)}★/${Number(total).toLocaleString('en-US')}`);
  }
  updated++;

  // The English file first — the translations' hash is computed from it.
  parsed.data.description = after;
  if (!DRY) await writeFile(full, matter.stringify(parsed.content, parsed.data), 'utf8');

  // Then each translation: same figures, its own words.
  const badgeOnly = differsOnlyInBadge(before, after);
  for (const lang of LANGS) {
    const tf = join(I18N, lang, file);
    if (!existsSync(tf)) continue;
    let tp;
    try { tp = matter(await readFile(tf, 'utf8')); } catch { continue; }
    const tAfter = resyncBadge(tp.data.description, rating, total);
    if (!tAfter) continue;
    tp.data.description = tAfter;

    // Re-stamp so the freshness check does not read a number-only edit as
    // "the English changed, re-translate everything".
    if (badgeOnly) {
      tp.data.srcHash = srcHashOf({
        title: parsed.data.title,
        description: after,
        quickAnswer: parsed.data.quickAnswer,
        faq: parsed.data.faq,
        body: parsed.content,
      });
    } else {
      trStale++; // prose moved too — leave the old hash, let the translator run
    }
    if (!DRY) await writeFile(tf, matter.stringify(tp.content, tp.data), 'utf8');
    trUpdated++;
  }
}

console.log(`\n⭐ Rating badges — ${scanned} post(s) carry one`);
examples.forEach((e) => console.log(`   ${e}`));
console.log(`\n📦 ${updated} English description(s), ${trUpdated} translation(s) resynced${trStale ? `, ${trStale} left flagged stale (prose changed too)` : ''}${DRY ? ' (DRY — nothing written)' : ''}`);
