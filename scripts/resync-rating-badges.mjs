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
import { srcHashOfPostFile } from './lib/src-hash.mjs';

const POSTS = 'src/content/posts';
const I18N = 'src/content/i18n';
const LANGS = ['ko', 'ja', 'es', 'zh'];
const DRY = process.env.DRY === '1';

let scanned = 0, updated = 0, trUpdated = 0, trStale = 0, refused = 0;
const examples = [];

// Files are edited as TEXT. A gray-matter round-trip was how this script wrote
// until 2026-08-17, and the first run that actually reached the translations
// produced 3,097 changed lines for 88 one-figure fixes: srcHash lost its quotes
// (a hash of only digits would have become a NUMBER — see the yaml unquoted
// scalar trap), and description, quickAnswer and every FAQ answer were refolded
// into `>-` blocks. backfill-descriptions and fix-cjk-punctuation both learned
// this already: parse to VERIFY, never to write.
//
// Rewriting digits inside the frontmatter TEXT cannot change YAML structure —
// no newline is added or removed, and the badge regex needs "★" followed by a
// parenthesised count, which the title's bare "(4.2★)" never matches.
function splitFrontmatter(raw) {
  if (!raw.startsWith('---')) return null;
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/);
  return m ? { head: m[0], front: m[1], body: raw.slice(m[0].length) } : null;
}

/**
 * Everything except `description` (and `srcHash`, when this run deliberately
 * re-stamped it) must come back identical.
 */
function onlyDescriptionMoved(beforeRaw, afterRaw, alsoAllowed = []) {
  let a, b;
  try { a = matter(beforeRaw).data; b = matter(afterRaw).data; } catch { return false; }
  const keys = Object.keys(a).sort();
  if (keys.join(',') !== Object.keys(b).sort().join(',')) return false;
  const allowed = new Set(['description', ...alsoAllowed]);
  return keys.every((k) => allowed.has(k) || JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

for (const file of (await readdir(POSTS)).filter((f) => f.endsWith('.md'))) {
  const full = join(POSTS, file);
  const enRaw = await readFile(full, 'utf8');
  const enParts = splitFrontmatter(enRaw);
  if (!enParts) continue;
  let parsed;
  try { parsed = matter(enRaw); } catch { continue; }
  const d = parsed.data;
  if (d.draft) continue;

  const rating = d.place?.rating;
  const total = d.place?.userRatingsTotal;
  const before = String(d.description ?? '');
  if (!readBadge(before)) continue;
  scanned++;

  // The English badge and each translation's badge are checked INDEPENDENTLY.
  // This used to bail out here whenever English was already correct, which put
  // the translations behind a gate only English could open: a translation that
  // drifted on its own became unreachable the moment the English figure was
  // fixed. On 2026-08-17 that was 88 Spanish descriptions quoting figures no
  // run could ever reach, against 0 in ko/ja/zh.
  const after = resyncBadge(before, rating, total);

  if (after) {
    const claimed = readBadge(before);
    if (examples.length < 5) {
      examples.push(`${file}: ${claimed.rating}★/${claimed.total.toLocaleString('en-US')} → ${Number(rating).toFixed(1)}★/${Number(total).toLocaleString('en-US')}`);
    }
    updated++;

    // The English file first — the translations' hash is computed from it.
    const enNext = enParts.head.replace(enParts.front, resyncBadge(enParts.front, rating, total) ?? enParts.front) + enParts.body;
    if (!onlyDescriptionMoved(enRaw, enNext)) {
      console.error(`  ⚠ ${file}: frontmatter changed shape — skipped`);
      refused++;
      updated--;
      continue;
    }
    if (!DRY) await writeFile(full, enNext, 'utf8');
  }

  // Then each translation: same figures, its own words.
  // Only an English edit can invalidate a translation's srcHash; when English
  // did not move there is nothing to re-stamp and the stored hash stays valid.
  const badgeOnly = after ? differsOnlyInBadge(before, after) : false;
  for (const lang of LANGS) {
    const tf = join(I18N, lang, file);
    if (!existsSync(tf)) continue;
    const tRaw = await readFile(tf, 'utf8');
    const tParts = splitFrontmatter(tRaw);
    if (!tParts) continue;
    const frontAfter = resyncBadge(tParts.front, rating, total);
    if (!frontAfter) continue;

    // Re-stamp so the freshness check does not read a number-only edit as
    // "the English changed, re-translate everything".
    // Hash the FILE the way translate-posts reads it. This used to be built
    // from the pieces with gray-matter's untrimmed `.content`, which produces a
    // DIFFERENT value for the same file — so the re-stamp wrote a hash the
    // translator did not recognise and every badge edit re-queued all four
    // translations anyway (measured 2026-08-17: 11 of the 18 posts in the
    // 08-16 refresh were re-translated the next day). See srcHashOfPostFile.
    const newHash = badgeOnly ? srcHashOfPostFile(enParts.head.replace(enParts.front, resyncBadge(enParts.front, rating, total) ?? enParts.front) + enParts.body) : null;
    let front = frontAfter;
    if (newHash) {
      front = front.replace(/^(srcHash:\s*)(['"]?)[0-9a-f]{12}\2(\s*)$/m, `$1$2${newHash}$2$3`);
    } else if (after) {
      trStale++; // prose moved too — leave the old hash, let the translator run
    }

    const tNext = tParts.head.replace(tParts.front, front) + tParts.body;
    // Same read-back as the English side, plus srcHash: the only frontmatter
    // this tool may move is description, and srcHash only when it re-stamped.
    if (!onlyDescriptionMoved(tRaw, tNext, newHash ? ['srcHash'] : [])) {
      console.error(`  ⚠ ${lang}/${file}: frontmatter changed shape — skipped`);
      refused++;
      continue;
    }
    if (!DRY) await writeFile(tf, tNext, 'utf8');
    trUpdated++;
  }
}

console.log(`\n⭐ Rating badges — ${scanned} post(s) carry one`);
examples.forEach((e) => console.log(`   ${e}`));
console.log(`\n📦 ${updated} English description(s), ${trUpdated} translation(s) resynced${trStale ? `, ${trStale} left flagged stale (prose changed too)` : ''}${refused ? `, ${refused} skipped on the read-back guard` : ''}${DRY ? ' (DRY — nothing written)' : ''}`);
