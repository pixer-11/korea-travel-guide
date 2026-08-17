#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  PROSE RATING RESYNC — the sentence version of resync-rating-badges.
//
//  The weekly refresh moves place.rating, resync-rating-badges rewrites the
//  "4.7★ (706 reviews)" badge in the meta description, and until today nothing
//  touched the same figure written into a SENTENCE. So ayutthaya-ayutthaya-
//  historical-park shipped "verified visitor ratings put it at 4.8 stars"
//  above a fact box reading 4.7 — the two numbers on one page disagreeing.
//
//  293 live posts bake a rating into prose (86% of the posts written on Jul 21,
//  against 0-8% of this week's — the writer prompt was fixed, this is residue).
//  Every one of them is a number Google can move underneath us, which is why
//  this runs on a schedule instead of being cleaned up by hand.
//
//  Deterministic: it only ever swaps digits, in the English body and in the
//  four translations of it, then re-stamps each translation's srcHash so a
//  number-only edit does not queue 1,172 pointless re-translations. No model
//  call, so it cannot invent prose and cannot send a bill.
//
//  HEDGES ARE NEVER REWRITTEN. "a rating that consistently sits above 4.5" is
//  still true at 4.6 and would become FALSE if resynced. Those are reported by
//  validate-content when their own logic breaks; see prose-rating-sync.mjs.
//
//    node scripts/resync-prose-ratings.mjs            # report only
//    node scripts/resync-prose-ratings.mjs --apply    # rewrite the files
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import matter from 'gray-matter';
import { findRatings, syncProseRating, differsOnlyInRating } from './lib/prose-rating-sync.mjs';
import { srcHashOfPostFile } from './lib/src-hash.mjs';

const APPLY = process.argv.includes('--apply');
const POSTS = 'src/content/posts';
const I18N = 'src/content/i18n';
const LANGS = ['ko', 'ja', 'es', 'zh'];

// Editing a translation changes its content hash, which is how the naturalness
// store decides a translation needs re-judging. A digit swap cannot make a
// translation read worse, so the stored score is carried forward and only the
// hash is re-stamped — the same call fix-cjk-punctuation made, for the same
// reason: a repair that bills the next stage for its own edit turns a nightly
// job into a nightly invoice.
const QUALITY_STORE = 'data/translation-quality.json';
const quality = existsSync(QUALITY_STORE) ? JSON.parse(readFileSync(QUALITY_STORE, 'utf8')) : null;
let restamped = 0;
const restampQuality = (key, raw) => {
  const entry = quality?.[key];
  if (!entry?.hash) return;
  entry.hash = createHash('sha1').update(raw).digest('hex').slice(0, 12);
  restamped++;
};

// The file is edited as TEXT, never re-serialized. A gray-matter round-trip
// strips the quotes off srcHash and re-wraps quickAnswer into a >- block —
// backfill-descriptions and fix-cjk-punctuation both taught this the hard way.
// Parse to VERIFY, never to write.
function splitFrontmatter(raw) {
  if (!raw.startsWith('---')) return null;
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/);
  return m ? { head: m[0], front: m[1], body: raw.slice(m[0].length) } : null;
}

/** The stale exact rating a body claims, or null. */
function staleClaim(body, live) {
  for (let tenth = 10; tenth <= 50; tenth++) {
    const value = tenth / 10;
    if (Math.abs(value - live) < 0.05) continue;
    if (findRatings(body, value).some((h) => !h.hedge)) return value;
  }
  return null;
}

let scanned = 0, fixed = 0, trFixed = 0, trStale = 0, skipped = 0;
const examples = [];

for (const file of readdirSync(POSTS).filter((f) => f.endsWith('.md'))) {
  const enPath = join(POSTS, file);
  const enRaw = readFileSync(enPath, 'utf8');
  const parts = splitFrontmatter(enRaw);
  if (!parts) continue;
  let en;
  try { en = matter(enRaw); } catch { continue; }
  if (en.data.draft) continue;

  const live = en.data.place?.rating;
  if (!(Number(live) > 0)) continue;
  scanned++;

  const stale = staleClaim(parts.body, live);
  if (stale === null) continue;

  const next = syncProseRating(parts.body, stale, live);
  if (!next.count) continue;

  examples.push(`${file}: ${stale} → ${Number(live).toFixed(1)} (${next.count}×)`);
  fixed++;
  if (!APPLY) continue;

  const enNext = parts.head + next.text;
  // Read back: the frontmatter must be untouched, byte for byte. This tool has
  // no business in it — the description badge is another tool's surface.
  if (!enNext.startsWith(parts.head) || matter(enNext).data.place?.rating !== live) {
    console.error(`  ⚠ ${file}: frontmatter moved — skipped`);
    skipped++;
    continue;
  }
  writeFileSync(enPath, enNext);

  // The translations carry the same digits in their own words.
  const bodyOnly = differsOnlyInRating(parts.body, next.text, stale, live);
  // Hash the FILE, not the pieces — see srcHashOfPostFile. Building the hash
  // from gray-matter's untrimmed .content produces a value translate-posts
  // never recognises, which re-queues the very translations this re-stamp is
  // here to spare.
  const newHash = srcHashOfPostFile(enNext);

  for (const lang of LANGS) {
    const tPath = join(I18N, lang, file);
    if (!existsSync(tPath)) continue;
    const tRaw = readFileSync(tPath, 'utf8');
    const tParts = splitFrontmatter(tRaw);
    if (!tParts) continue;

    const tNext = syncProseRating(tParts.body, stale, live);
    if (!tNext.count) continue;

    // Re-stamp so the freshness check does not read a number-only edit as
    // "the English changed, re-translate everything". Only when the English
    // edit really was number-only — otherwise the translation is genuinely
    // stale and keeps its old hash for the translator to pick up.
    let front = tParts.front;
    if (bodyOnly && newHash) {
      front = front.replace(/^(srcHash:\s*)(['"]?)[0-9a-f]{12}\2(\s*)$/m, `$1$2${newHash}$2$3`);
    } else {
      trStale++;
    }

    const out = tParts.head.replace(tParts.front, front) + tNext.text;
    const before = matter(tRaw), after = matter(out);
    const keysSame = Object.keys(before.data).sort().join(',') === Object.keys(after.data).sort().join(',');
    const onlyHash = String(before.data.title) === String(after.data.title)
      && String(before.data.description) === String(after.data.description);
    if (!keysSame || !onlyHash) {
      console.error(`  ⚠ ${lang}/${file}: frontmatter changed shape — skipped`);
      skipped++;
      continue;
    }
    writeFileSync(tPath, out);
    restampQuality(`${lang}/${file.replace(/\.md$/, '')}`, out);
    trFixed++;
  }
}

if (APPLY && restamped) {
  writeFileSync(QUALITY_STORE, JSON.stringify(quality, null, 1) + '\n');
}

console.log(`\n⭐ Prose ratings — ${scanned} live post(s) carry a live rating`);
examples.slice(0, 10).forEach((e) => console.log(`   ${e}`));
console.log(
  `\n📦 ${fixed} English body/bodies, ${trFixed} translation(s) resynced`
  + `${trStale ? `, ${trStale} left flagged stale (prose moved too)` : ''}`
  + `${restamped ? `, ${restamped} quality score(s) carried forward` : ''}`
  + `${skipped ? `, ${skipped} skipped on the read-back guard` : ''}`
  + `${APPLY ? '' : ' (report only — add --apply to write)'}`,
);
console.log(`PROSE_RATING_SUMMARY posts=${fixed} translations=${trFixed} applied=${APPLY}`);
