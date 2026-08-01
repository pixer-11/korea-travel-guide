#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  HERO WIDTH UPGRADE — Google Discover only serves large image cards from
//  photos ≥1200px wide. This targets LIVE posts whose current hero is real and
//  correct but too narrow, and tries to swap in a WIDER photo of the SAME
//  venue. It is NOT the mismatch patrol: a post with no wider verified photo
//  keeps its current hero (a real 1080px photo beats a wrong 1920px one) and
//  is never drafted, never retired, never counted against any clock.
//
//  Per post: probe the current hero's true pixel width (skip if already
//  ≥1200) → collect candidates (Foursquare/Flickr when keys exist, Wikimedia
//  always; events use the event-mode Commons resolver with the filename
//  identity audit) → keep only candidates whose PROBED width is ≥1200 →
//  MANDATORY vision gate per candidate → first pass replaces the hero.
//
//  Env: SLUGS (comma-separated, required), ANTHROPIC_API_KEY (vision),
//  FOURSQUARE_API_KEY / FLICKR_API_KEY (optional venue sources), DRY=1.
//  Usage: SLUGS=a,b,c node scripts/upgrade-hero-width.mjs
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { loadUsedImageUrls, resolveHero, eventTopic } from './lib/images.mjs';
import { keyToken, tokens } from './lib/commons.mjs';
import { venuePhotoCandidates } from './lib/photo-sources.mjs';
import { verifyHeroImage } from './lib/vision-check.mjs';

const POSTS = 'src/content/posts';
const DRY = process.env.DRY === '1';
const MIN_WIDTH = 1200;
const SLUGS = (process.env.SLUGS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!SLUGS.length) {
  console.error('SLUGS env is required (comma-separated slugs). Refusing a blind full-repo sweep.');
  process.exit(1);
}

const UA = { 'User-Agent': 'WanderAtlasBot/1.0 (https://wanderatlasguides.com)' };

// True pixel width of an image URL. Wikimedia originals go through the
// imageinfo API (authoritative, no download); everything else range-fetches
// the first 128KB and parses the JPEG SOF / PNG IHDR header. null = unknown,
// and unknown is treated as "not proven wide enough" everywhere below.
function parseImageWidth(buf) {
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) return buf.readUInt32BE(16); // PNG IHDR
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) { // JPEG: scan for SOFn
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) return null;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return buf.readUInt16BE(i + 7); // SOF: len(2) precision(1) height(2) width(2)
      }
      i += 2 + len;
    }
  }
  return null;
}

export async function probeWidth(url) {
  try {
    if (/upload\.wikimedia\.org/.test(url)) {
      const thumb = url.match(/\/thumb\/.*?\/(\d+)px-[^/]+$/);
      if (thumb) return Number(thumb[1]);
      const file = decodeURIComponent(String(url).split('/').pop() || '');
      const q = new URLSearchParams({
        action: 'query', titles: `File:${file}`, prop: 'imageinfo', iiprop: 'size', format: 'json',
      });
      const res = await fetch(`https://commons.wikimedia.org/w/api.php?${q}`, { headers: UA });
      if (!res.ok) return null;
      const j = await res.json();
      const ii = Object.values(j?.query?.pages || {})[0]?.imageinfo?.[0];
      return ii?.width ?? null;
    }
    const res = await fetch(url, { headers: { ...UA, Range: 'bytes=0-131071' } });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return parseImageWidth(Buffer.from(ab.slice(0, 131072)));
  } catch {
    return null;
  }
}

const HAVE_VENUE_SOURCES = Boolean(process.env.FOURSQUARE_API_KEY || process.env.FLICKR_API_KEY);
if (!HAVE_VENUE_SOURCES) console.log('No FSQ/Flickr keys — Wikimedia is the only venue source this run.');

const used = await loadUsedImageUrls(POSTS);
const replaced = [], keptNoWider = [], keptVisionOutage = [], alreadyWide = [], skipped = [];

for (const slug of SLUGS) {
  const path = `${POSTS}/${slug}.md`;
  if (!existsSync(path)) { skipped.push(`${slug} (missing)`); console.log(`  ⏭️  ${slug}: file not found`); continue; }
  const { data, content } = matter(await readFile(path, 'utf8'));
  if (data.draft === true) { skipped.push(`${slug} (draft)`); console.log(`  ⏭️  ${slug}: draft — this tool never touches quarantined posts`); continue; }
  const curUrl = data.heroImage?.url || '';
  if (!curUrl) { skipped.push(`${slug} (no hero)`); continue; }

  const curW = await probeWidth(curUrl);
  if (curW && curW >= MIN_WIDTH) {
    alreadyWide.push(slug);
    console.log(`  ✓  ${slug}: current hero already ${curW}px — nothing to do`);
    continue;
  }

  const isEvent = data.category === 'event';
  const VENUE_CATS = new Set(['restaurant', 'trendy', 'hidden-gem', 'attraction']);
  const titleName = String(data.title).split(/[:—]/)[0].replace(/\s+in\s+.+$/i, '').trim();
  const venueName = data.place?.name || (isEvent || VENUE_CATS.has(data.category) ? titleName : titleName);
  const ctx = { name: venueName, category: data.category, region: data.region, country: data.country, eventMode: isEvent };

  // Candidate stream, identical sourcing to backfill-photos-alt.mjs.
  let cands = [];
  if (isEvent) {
    // Event identity lives in the FILENAME (vision cannot tell acts apart):
    // same audit as the backfill patrol — a file that names neither the act
    // nor only the event's own words is some other act's photo.
    const anchor = keyToken(venueName);
    const knownTok = new Set([
      ...tokens(venueName), ...tokens(eventTopic(venueName)),
      ...tokens(data.region || ''), ...tokens(data.country || ''),
    ]);
    const GENERIC_FILE_WORDS = new Set(['cropped', 'crop', 'photo', 'image', 'img', 'file', 'dsc', 'edit', 'edited', 'retouched', 'wikimedia', 'commons', 'flickr']);
    const foreignInFilename = (url) => {
      let file = String(url).split('/').pop() || '';
      try { file = decodeURIComponent(file); } catch {}
      const ft = tokens(file.replace(/\.(jpe?g|png)\b.*$/i, ''));
      if (anchor && ft.includes(anchor)) return '';
      return ft
        .filter((t) => !knownTok.has(t) && !GENERIC_FILE_WORDS.has(t))
        .filter((t) => !/^\d+(px)?$/.test(t))
        .join(' ');
    };
    const seen = new Set(used);
    for (let i = 0; i < 6; i++) {
      let pick = null;
      try {
        pick = await resolveHero({
          namedVenue: venueName, region: data.region, topic: eventTopic(venueName),
          country: data.country, used: seen, preferTopic: true, eventMode: true,
          allowUnsplash: false,
        });
      } catch {}
      if (!pick?.url || pick.license !== 'wikimedia') break;
      const foreign = foreignInFilename(pick.url);
      if (foreign) { console.log(`   ${slug}: candidate skipped — filename names another act (${foreign})`); continue; }
      cands.push(pick);
    }
  } else {
    if (HAVE_VENUE_SOURCES) {
      cands = await venuePhotoCandidates({
        name: venueName,
        lat: data.place?.lat, lng: data.place?.lng,
        near: `${data.region}, ${data.country ?? 'South Korea'}`,
      });
    }
    try {
      const wiki = await resolveHero({
        namedVenue: venueName, region: data.region,
        topic: (data.tags && data.tags[1]) || data.category,
        country: data.country, used, strict: true,
      });
      if (wiki?.url) { used.delete(wiki.url); cands.push(wiki); }
    } catch {}
  }

  // Width gate BEFORE the vision bill: a candidate that cannot prove ≥1200px
  // is exactly as useless as the current hero, however correct it looks.
  const wide = [];
  for (const cand of cands) {
    if (!cand?.url || cand.url === curUrl || used.has(cand.url)) continue;
    if (cand.w && cand.w < MIN_WIDTH) continue; // source metadata already rules it out
    const w = await probeWidth(cand.url);
    if (!w || w < MIN_WIDTH) continue;
    wide.push({ ...cand, probedW: w });
  }
  if (!wide.length) {
    keptNoWider.push(slug);
    console.log(`  ⏸️  ${slug}: no ≥${MIN_WIDTH}px candidate of this venue (${cands.length} candidates seen) — keeping current ${curW ?? '?'}px hero`);
    continue;
  }

  let done = false, outage = false;
  for (const cand of wide) {
    const vis = await verifyHeroImage({ url: cand.url, ...ctx });
    if (/vision unavailable|no-api-key|vision check failed/i.test(vis.reason || '')) { outage = true; break; }
    if (!vis.ok) { console.log(`   ${slug}: rejected (${vis.reason})`); continue; }
    if (DRY) { console.log(`  · would replace ${slug} (${curW ?? '?'}px → ${cand.probedW}px) ← ${cand.url.slice(0, 70)}`); done = true; replaced.push({ slug, from: curW, to: cand.probedW }); break; }
    data.heroImage = { url: cand.url, credit: cand.credit, license: cand.license, source: cand.source };
    // Same dedup as the backfill patrol: a hero promoted from the candidate
    // pool can already be sitting in the gallery — drop the gallery copy.
    if (Array.isArray(data.gallery)) {
      const kept = data.gallery.filter((g) => g?.url !== cand.url);
      if (kept.length !== data.gallery.length) console.log(`   ${slug}: dropped in-body photo — it is now the hero`);
      if (kept.length) data.gallery = kept;
      else delete data.gallery;
    }
    await writeFile(path, `---\n${yaml.dump(data, { lineWidth: -1, noRefs: true, sortKeys: false })}---\n${content}`, 'utf8');
    used.add(cand.url);
    replaced.push({ slug, from: curW, to: cand.probedW });
    console.log(`  ✅ ${slug}: hero upgraded ${curW ?? '?'}px → ${cand.probedW}px (${vis.reason})`);
    done = true;
    break;
  }
  if (!done) {
    if (outage) {
      keptVisionOutage.push(slug);
      console.log(`  ⏸️  ${slug}: vision unavailable — keeping current hero, retry another run`);
    } else {
      keptNoWider.push(slug);
      console.log(`  ⏸️  ${slug}: ${wide.length} wide candidate(s) all failed vision — keeping current ${curW ?? '?'}px hero`);
    }
  }
}

console.log(`\n📦 ${SLUGS.length} slug(s): ${replaced.length} upgraded · ${keptNoWider.length} no wider photo · ${alreadyWide.length} already ≥${MIN_WIDTH}px · ${keptVisionOutage.length} vision outage · ${skipped.length} skipped`);
if (replaced.length) console.log('UPGRADED_LIST ' + replaced.map((r) => `${r.slug}:${r.from ?? '?'}->${r.to}`).join(','));
if (keptNoWider.length) console.log('NOWIDER_LIST ' + keptNoWider.join(','));
if (keptVisionOutage.length) console.log('OUTAGE_LIST ' + keptVisionOutage.join(','));
console.log(`WIDTH_SUMMARY upgraded=${replaced.length} nowider=${keptNoWider.length} alreadywide=${alreadyWide.length} outage=${keptVisionOutage.length} skipped=${skipped.length}`);
