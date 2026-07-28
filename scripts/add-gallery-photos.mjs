// ─────────────────────────────────────────────────────────────
//  IN-BODY GALLERY PHOTOS — adds ONE extra, verified photo to a post.
//
//  Sources: Wikimedia Commons FIRST (landmarks), then the venue's own
//  Foursquare photos. Commons was the only source at first, on the grounds
//  that Foursquare forbids CACHING — but we never cache it: 163 live heroes
//  already hotlink fastly.4sqi.net, which is the same exposure a second
//  hotlink adds. Commons-only meant every named cafe and restaurant got
//  nothing (0 of 23 in the pilot), because an encyclopedia has Wat Arun and
//  not a neighbourhood coffee shop. Foursquare returns up to 4 photos per
//  venue and the hero uses one, so a real second photo usually exists.
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
import { commonsBest, tokens } from './lib/commons.mjs';
import { venuePhotoCandidates } from './lib/photo-sources.mjs';
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

// Every image URL already in use ANYWHERE — heroes and existing gallery entries
// alike. loadUsedImageUrls() only matches the hero's 2-space `url:` line, so
// gallery entries (`  - url:`) were invisible to it and a later post's HERO
// could be handed a photo already sitting mid-article in another post.
const usedUrls = new Set();
for (const f of files) {
  const raw = readFileSync(`${POSTS_DIR}/${f}`, 'utf8');
  // Matches a hero line ("  url: …") and a gallery item ("  - url: …") alike.
  const re = /url:\s*"?'?([^\s"']+)"?'?/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const u = m[1];
    if (u.startsWith('http') || u.startsWith('/')) usedUrls.add(u);
  }
}

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

  const candidates = [];
  try {
    // crossCheck/minCross mirror the HERO path: one shared token (a city name)
    // is not evidence of identity — that hole is how a UK picture house once
    // landed on an Abu Dhabi cafe.
    const wiki = await commonsBest(query, {
      used: new Set([heroUrl]),
      minWidth: 1200,
      crossCheck: tokens(`${venue} ${d.region}`),
      minCross: 2,
    });
    if (wiki?.url) candidates.push({ ...wiki, license: 'wikimedia' });
  } catch (e) {
    process.stdout.write(`  → Commons 실패 (${e.message.slice(0, 40)})`);
  }

  // The venue's OWN photos — the only source that has a neighbourhood cafe.
  try {
    for (const c of await venuePhotoCandidates({
      name: venue,
      lat: d.place?.lat,
      lng: d.place?.lng,
      near: `${d.region}, ${d.country || 'South Korea'}`,
    })) {
      if (c.url && c.url !== heroUrl) candidates.push(c);
      if (candidates.length >= 4) break;
    }
  } catch (e) {
    process.stdout.write(`  → 장소사진 실패 (${e.message.slice(0, 40)})`);
  }

  if (!candidates.length) { stats.noCandidate++; process.stdout.write('  → 후보 없음'); continue; }

  // Try each candidate; the gate rejects a wrong place AND a near-duplicate of
  // the hero, so a rejection is a reason to try the next one, not to give up.
  let cand = null, lastReason = '', okReason = '';
  for (const c of candidates) {
    if (usedUrls.has(c.url)) continue;   // already the hero or gallery of another post
    const check = await verifyGalleryImage({
      url: c.url,
      heroUrl,
      name: venue,
      category: d.category || 'place',
      region: d.region,
      country: d.country || 'South Korea',
    });
    // Belt and braces: even if the model says ok, a hedged reason means it was
    // not certain — and an uncertain second photo is worse than none at all.
    const hedged = /probabl|plausib|likely|appears to|could be|maybe|possibly/i.test(check.reason || '');
    if (check.ok && hedged) {
      lastReason = `불확실(${check.reason})`;
      process.stdout.write(`
    · 반려(확신부족): ${check.reason}`);
      continue;
    }
    if (check.ok) { cand = c; okReason = check.reason; break; }
    lastReason = check.reason;
    process.stdout.write(`\n    · 반려(${(c.license || '').slice(0, 10)}): ${check.reason}`);
  }
  if (!cand) {
    stats.rejected++;
    rejected.push({ file, reason: lastReason || 'no candidate passed' });
    process.stdout.write(`  → ❌ 전부 반려`);
    continue;
  }

  const entry = { url: cand.url, credit: cand.credit, license: cand.license || 'wikimedia', source: cand.source };
  usedUrls.add(cand.url);
  if (!DRY_RUN) {
    const out = withGallery(post.raw, [entry]);
    if (!out) { process.stdout.write('  → ⚠️ frontmatter 형식 불명 — 건너뜀'); continue; }
    writeFileSync(join(POSTS_DIR, file), out);
  }
  stats.added++;
  added.push({ file, url: cand.url, reason: okReason });
  process.stdout.write(`  → ✅ 추가${DRY_RUN ? ' (모의실행)' : ''}: ${okReason}`);
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
