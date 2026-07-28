#!/usr/bin/env node
// GEOCODE PLACELESS POSTS — attaches a real `place:` block (Google Places
// verified) to posts that were generated "placeless" (neighborhood/venue
// guides with no place.id, so no lat/lng and no itinerary-page join). Every
// attach is confidence-gated so a same-named venue in the WRONG city (e.g.
// "Oxomoco" exists in both Tokyo and Brooklyn) can never get attached.
//
// Facts-only rule: every field written into `place:` comes verbatim from the
// Places API response. We never invent an id, address, or coordinate.
//
//   node scripts/geocode-placeless.mjs --dry-run             # plan only, no API call
//   node scripts/geocode-placeless.mjs --dry-run --region=Seoul
//   node scripts/geocode-placeless.mjs --region=Seoul --limit=5
//   node scripts/geocode-placeless.mjs                        # all placeless posts, all regions
import './lib/env.mjs'; // MUST be first — loads .env before places.mjs reads the API key
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { searchPlaces } from './lib/places.mjs';
import { haversineKm } from '../src/lib/itinerary.mjs';

const POSTS_DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));

const CITY_RADIUS_KM = 40;

// ── CLI args ─────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
export const DRY_RUN = argv.includes('--dry-run');
export const REGION = (argv.find((a) => a.startsWith('--region=')) || '').split('=')[1] || null;
const limitRaw = (argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1];
export const LIMIT = limitRaw ? Number(limitRaw) : Infinity;

// ── pure helpers (unit-tested in geocode-placeless.test.mjs) ───────────────

// Trim a title down to whatever's left after removing wrapping quote chars.
export function stripQuotes(s) {
  return String(s || '').trim().replace(/^['"“”‘’]+|['"“”‘’]+$/g, '').trim();
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// "Ikseon-Dong in Seoul" + "Seoul" → "Ikseon-Dong"
// "CAFE 3 STRIPES SEOUL" + "Seoul" → "CAFE 3 STRIPES SEOUL" (no trailing " in {region}" to strip)
export function titleMainPart(title, region) {
  let t = stripQuotes(title);
  if (region) {
    const re = new RegExp(`\\s+in\\s+${escapeRegExp(String(region).trim())}$`, 'i');
    t = t.replace(re, '').trim();
  }
  return stripQuotes(t);
}

export function buildQuery(title, region) {
  return `${titleMainPart(title, region)} ${region}`.trim();
}

const STOPWORDS = new Set(['in', 'the', 'a', 'of', 'and', 'cafe', 'cafes', 'restaurant', 'street', 'market']);

// lowercase, hyphen/space-insensitive, punctuation stripped.
function normTokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// Gate (b): ≥50% of the significant tokens of titleMainPart appear in the
// result's displayName, OR displayName's tokens are a subset of the title's.
export function nameGatePass(tmp, region, displayName) {
  const regionTokens = new Set(normTokens(region));
  const titleTokens = normTokens(tmp).filter((t) => !STOPWORDS.has(t) && !regionTokens.has(t));
  const nameTokens = normTokens(displayName);
  if (!titleTokens.length || !nameTokens.length) return false;
  const nameTokenSet = new Set(nameTokens);
  const hits = titleTokens.filter((t) => nameTokenSet.has(t)).length;
  const overlapRatio = hits / titleTokens.length;
  const titleTokenSet = new Set(titleTokens);
  const subsetOk = nameTokens.every((t) => titleTokenSet.has(t) || STOPWORDS.has(t) || regionTokens.has(t));
  return overlapRatio >= 0.5 || subsetOk;
}

// Gate (c): if businessStatus is present it must not be a CLOSED_* value.
export function businessStatusOk(status) {
  if (!status) return true;
  return !/^CLOSED/i.test(status);
}

// Full confidence gate — all three checks must pass, in spec order (a)(b)(c).
// centroid is { lat, lng } | null (null ⇒ address-match only for gate a).
export function evaluateGate({ titleMainPart: tmp, region, result, centroid }) {
  const addr = String(result?.address || '');
  const addressHasRegion = region ? addr.toLowerCase().includes(String(region).toLowerCase()) : false;
  let km = null;
  if (!addressHasRegion && centroid && typeof result?.lat === 'number' && typeof result?.lng === 'number') {
    km = haversineKm(centroid.lat, centroid.lng, result.lat, result.lng);
  }
  const withinRadius = km != null && km < CITY_RADIUS_KM;
  if (!addressHasRegion && !withinRadius) {
    const detail = !centroid
      ? 'no centroid available for this region (address-only match required)'
      : km != null
        ? `${Math.round(km)}km from centroid (>${CITY_RADIUS_KM}km)`
        : 'result has no usable coordinates';
    return { pass: false, reason: `city mismatch — address "${result?.address || '?'}" doesn't mention "${region}" and ${detail}` };
  }
  if (!nameGatePass(tmp, region, result?.name)) {
    return { pass: false, reason: `name mismatch — "${tmp}" vs result name "${result?.name}"` };
  }
  if (!businessStatusOk(result?.businessStatus)) {
    return { pass: false, reason: `closed (businessStatus=${result.businessStatus})` };
  }
  return { pass: true, reason: 'ok' };
}

export function computeCentroid(coords) {
  if (!coords || !coords.length) return null;
  const lat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
  const lng = coords.reduce((s, c) => s + c.lng, 0) / coords.length;
  return { lat, lng };
}

// region → { lat, lng } | null, computed from every OTHER post in that
// region that already carries place.lat/lng (non-draft only).
export function buildCentroids(posts) {
  const byRegion = new Map();
  for (const p of posts) {
    if (p.fm.draft) continue;
    const pl = p.fm.place;
    const region = p.fm.region;
    if (!region || !pl || typeof pl.lat !== 'number' || typeof pl.lng !== 'number') continue;
    if (!byRegion.has(region)) byRegion.set(region, []);
    byRegion.get(region).push({ lat: pl.lat, lng: pl.lng });
  }
  const centroids = new Map();
  for (const [region, coords] of byRegion) centroids.set(region, computeCentroid(coords));
  return centroids;
}

export function isTarget(fm) {
  return Boolean(fm) && !fm.place && !fm.draft && fm.category !== 'event';
}

// Normalized places.mjs result → the exact `place:` block shape used
// elsewhere in the repo (see e.g. los-angeles-griffith-observatory.md).
export function buildPlaceBlock(result) {
  const place = { id: result.id, name: result.name, address: result.address };
  if (result.rating != null) place.rating = result.rating;
  if (result.userRatingsTotal != null) place.userRatingsTotal = result.userRatingsTotal;
  place.googleMapsUrl = result.googleMapsUrl;
  if (result.businessStatus) place.businessStatus = result.businessStatus;
  place.lat = result.lat;
  place.lng = result.lng;
  return place;
}

// Insert `place` right after `gallery` (or `heroImage` if there's no
// gallery key) to match the field order generate.mjs already writes.
// Falls back to appending at the end. Every other key/value is untouched.
export function insertPlaceIntoFrontmatter(fm, place) {
  const keys = Object.keys(fm);
  const afterKey = keys.includes('gallery') ? 'gallery' : keys.includes('heroImage') ? 'heroImage' : null;
  const out = {};
  let inserted = false;
  for (const k of keys) {
    out[k] = fm[k];
    if (afterKey && k === afterKey) {
      out.place = place;
      inserted = true;
    }
  }
  if (!inserted) out.place = place;
  return out;
}

// ── file IO ──────────────────────────────────────────────────────────────

export async function loadPosts(dir = POSTS_DIR) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md'));
  const out = [];
  for (const file of files) {
    const filePath = join(dir, file);
    const raw = await readFile(filePath, 'utf8');
    let parsed;
    try {
      parsed = matter(raw);
    } catch {
      continue; // unparsable frontmatter — not our problem to fix here
    }
    if (!parsed.data) continue;
    out.push({ file, filePath, fm: parsed.data, body: parsed.content });
  }
  return out;
}

// Round-trips the frontmatter through js-yaml (load happened in loadPosts via
// gray-matter, which uses js-yaml internally) and rewrites ONLY the
// frontmatter block; `body` (prose/images) is passed through byte-for-byte.
export async function writePostFile(filePath, fm, body) {
  const out = `---\n${yaml.dump(fm, { lineWidth: -1, noRefs: true, sortKeys: false })}---\n${body}`;
  await writeFile(filePath, out, 'utf8');
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  const allPosts = await loadPosts();
  const centroids = buildCentroids(allPosts);

  let targets = allPosts.filter((p) => isTarget(p.fm));
  if (REGION) targets = targets.filter((p) => String(p.fm.region || '').toLowerCase() === REGION.toLowerCase());
  if (Number.isFinite(LIMIT)) targets = targets.slice(0, LIMIT);

  if (DRY_RUN) {
    console.log(
      `DRY RUN — ${targets.length} placeless target(s)${REGION ? ` in ${REGION}` : ' across all regions'} (no API calls):\n`
    );
    for (const t of targets) {
      const query = buildQuery(t.fm.title, t.fm.region);
      const centroidNote = centroids.has(t.fm.region) ? '' : ' [no centroid — address-match only]';
      console.log(`  · ${t.file} — title="${t.fm.title}" region=${t.fm.region} query="${query}"${centroidNote}`);
    }
    console.log(
      `\nGEOCODE RESULT: attached 0, skipped 0 of ${targets.length} (dry-run — no API calls made)`
    );
    return;
  }

  let attached = 0;
  let skipped = 0;
  for (const t of targets) {
    const region = t.fm.region;
    const tmp = titleMainPart(t.fm.title, region);
    const query = `${tmp} ${region}`.trim();

    let results;
    try {
      results = await searchPlaces(query, { max: 1 });
    } catch (e) {
      console.log(`SKIPPED (search error: ${e.message}): ${t.file}`);
      skipped++;
      continue;
    }
    const result = results?.[0];
    if (!result) {
      console.log(`SKIPPED (no search results for "${query}"): ${t.file}`);
      skipped++;
      continue;
    }

    const centroid = centroids.get(region) || null;
    const gate = evaluateGate({ titleMainPart: tmp, region, result, centroid });
    if (!gate.pass) {
      console.log(`SKIPPED (${gate.reason}): ${t.file}`);
      skipped++;
      continue;
    }

    const place = buildPlaceBlock(result);
    const nextFm = insertPlaceIntoFrontmatter(t.fm, place);
    await writePostFile(t.filePath, nextFm, t.body);
    console.log(`ATTACHED: ${t.file} ← ${result.name}`);
    attached++;
  }

  console.log(`\nGEOCODE RESULT: attached ${attached}, skipped ${skipped} of ${targets.length}`);
}

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
