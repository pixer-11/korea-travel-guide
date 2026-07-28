// ─────────────────────────────────────────────────────────────
//  IN-BODY GALLERY PHOTOS — adds ONE extra, verified photo to a post.
//
//  Why Wikimedia only: Google Places and Foursquare both forbid storing their
//  photos (Places: no caching; Foursquare: no >24h caching), and a second photo
//  doubles that exposure. Wikimedia Commons is CC-licensed and safe to reference
//  as long as we keep the attribution line — which we do, in the caption.
//
//  Every candidate must pass verifyGalleryImage(): the model sees the hero AND
//  the candidate together and rejects wrong-place photos AND near-duplicates.
//  Nothing is written unless it passes — a post with no good second photo simply
//  keeps its single hero, which is a perfectly good outcome.
//
//  Usage:  node scripts/add-gallery-photos.mjs           # 20 posts (pilot)
//          LIMIT=50 node scripts/add-gallery-photos.mjs
//          DRY_RUN=1 node scripts/add-gallery-photos.mjs # judge, write nothing
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { commonsBest } from './lib/commons.mjs';
import { verifyGalleryImage } from './lib/vision-check.mjs';

const POSTS_DIR = 'src/content/posts';
const LIMIT = Number(process.env.LIMIT || 20);
const DRY_RUN = process.env.DRY_RUN === '1';

// Generic words that make a Commons search return anything but the venue.
const STOP = /\b(cafe|café|restaurant|coffee|bar|shop|store|hotel|guide|travel|the|and|of|in|at)\b/gi;

function parse(file) {
  const raw = readFileSync(join(POSTS_DIR, file), 'utf8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return null;
  let data;
  try { data = yaml.load(m[1]); } catch { return null; }
  return { raw, fmText: m[1], body: m[2], data };
}

// Write the gallery back into the frontmatter, replacing the empty `gallery: []`.
// Uses js-yaml to serialize so quoting/escaping is always valid.
function withGallery(raw, gallery) {
  const block = yaml.dump({ gallery }, { lineWidth: -1 }).trimEnd();
  if (/^gallery:\s*\[\]\s*$/m.test(raw)) return raw.replace(/^gallery:\s*\[\]\s*$/m, block);
  if (/^gallery:\s*$/m.test(raw)) return raw.replace(/^gallery:\s*$/m, block);
  return null; // unknown shape — refuse rather than corrupt the file
}

const files = readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'));
const stats = { scanned: 0, noVenue: 0, noCandidate: 0, rejected: 0, added: 0, skipped: 0 };
const added = [];
const rejected = [];

for (const file of files) {
  if (stats.added >= LIMIT) break;
  const post = parse(file);
  if (!post) continue;
  const d = post.data;
  if (d.draft) continue;
  if (Array.isArray(d.gallery) && d.gallery.length > 0) { stats.skipped++; continue; }
  const heroUrl = d.heroImage?.url;
  if (!heroUrl || heroUrl.includes('placeholder')) { stats.skipped++; continue; }

  // Need a real venue name to search Commons for — a generic topic post would
  // just pull a random city photo, which is exactly what we don't want.
  const venue = d.place?.name;
  if (!venue) { stats.noVenue++; continue; }

  stats.scanned++;
  const query = `${venue} ${d.region}`.replace(STOP, ' ').replace(/\s+/g, ' ').trim();
  process.stdout.write(`\n[${stats.scanned}] ${file}\n  검색: "${query}"`);

  let cand = null;
  try {
    cand = await commonsBest(query, { used: new Set([heroUrl]), minWidth: 1200 });
  } catch (e) {
    process.stdout.write(`  → 검색 실패 (${e.message.slice(0, 40)})`);
  }
  if (!cand?.url) { stats.noCandidate++; process.stdout.write('  → 후보 없음'); continue; }

  const check = await verifyGalleryImage({
    url: cand.url,
    heroUrl,
    name: venue,
    category: d.category || 'place',
    region: d.region,
    country: d.country || 'South Korea',
  });
  if (!check.ok) {
    stats.rejected++;
    rejected.push({ file, reason: check.reason });
    process.stdout.write(`  → ❌ 반려: ${check.reason}`);
    continue;
  }

  const entry = { url: cand.url, credit: cand.credit, license: 'wikimedia', source: cand.source };
  if (!DRY_RUN) {
    const out = withGallery(post.raw, [entry]);
    if (!out) { process.stdout.write('  → ⚠️ frontmatter 형식 불명 — 건너뜀'); continue; }
    writeFileSync(join(POSTS_DIR, file), out);
  }
  stats.added++;
  added.push({ file, url: cand.url, reason: check.reason });
  process.stdout.write(`  → ✅ 추가${DRY_RUN ? ' (모의실행)' : ''}: ${check.reason}`);
}

console.log('\n\n──────── 결과 ────────');
console.log(`검사한 글: ${stats.scanned}  |  ✅ 추가: ${stats.added}  |  ❌ vision 반려: ${stats.rejected}  |  후보 없음: ${stats.noCandidate}`);
console.log(`(장소명 없어 건너뜀: ${stats.noVenue}, 이미 사진 있거나 대상 아님: ${stats.skipped})`);
if (added.length) {
  console.log('\n추가된 글:');
  for (const a of added) console.log(`  ✅ ${a.file} — ${a.reason}`);
}
if (rejected.length) {
  console.log('\n반려된 글(사진 없이 유지):');
  for (const r of rejected.slice(0, 10)) console.log(`  ❌ ${r.file} — ${r.reason}`);
}
console.log(`\nGALLERY_SUMMARY added=${stats.added} rejected=${stats.rejected} nocand=${stats.noCandidate}`);
