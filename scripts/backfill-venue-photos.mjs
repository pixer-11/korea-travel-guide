#!/usr/bin/env node
// Give every VENUE post (one with a Google place.id) a REAL, self-hosted Google
// Places photo of the actual place — the most fitting hero possible, and permanent.
// Runs in CI (the Places API key is CI-restricted). RESUMABLE: skips posts already
// self-hosted and stops cleanly on quota (429), so repeated daily runs converge.
// Posts with no place.id, or whose place has no usable photo, are left untouched
// (their Commons/Unsplash hero stays).
import './lib/env.mjs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlaceById } from './lib/places.mjs';
import { selfHostPlacePhoto } from './lib/images.mjs';
import { OFFTOPIC } from './lib/offtopic.mjs';

const POSTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'content', 'posts');
const LIMIT = Number(process.env.PHOTO_LIMIT || 0) || Infinity; // cap posts per run
// SLUGS env (comma-separated) → process ONLY these posts. Lets a quota-limited run
// spend the whole day's allowance on known-bad heroes first, before the rest.
const ONLY = new Set((process.env.SLUGS || '').split(',').map((s) => s.trim()).filter(Boolean));

const placeId = (src) => (src.match(/\n {2}id:\s*"?([^"\n]+?)"?\s*$/m) || [])[1]?.trim() || null;
const heroUrl = (src) => (src.match(/heroImage:\r?\n {2}url:\s*"?([^"\n]+?)"?\s*$/m) || [])[1]?.trim() || '';

async function usedUrls() {
  const urls = new Set();
  for (const f of await readdir(POSTS_DIR)) {
    if (!f.endsWith('.md')) continue;
    const u = heroUrl(await readFile(join(POSTS_DIR, f), 'utf8'));
    if (u) urls.add(u);
  }
  return urls;
}

const used = await usedUrls();
let done = 0, already = 0, noplace = 0, failed = 0;
let files = (await readdir(POSTS_DIR)).filter((x) => x.endsWith('.md'));
if (ONLY.size) files = files.filter((f) => ONLY.has(f.replace(/\.md$/, '')));

// Pre-scan → candidates (place.id posts that still need a self-hosted photo).
// Off-topic / mismatched heroes (the OFFTOPIC blocklist — a restaurant showing a
// moth specimen, a dune-bashing car, etc.) are sorted FIRST so the ugliest get
// fixed within the day's quota before the merely-not-yet-hosted ones.
// Posts the vision auditor (visual-audit.mjs) marked MISMATCH are top priority for
// a real photo, alongside the keyword OFFTOPIC ones — so the ugliest get fixed first
// within the day's quota. Self-maintaining: reads the committed audit results.
let VMISMATCH = new Set();
try {
  const va = JSON.parse(await readFile(join(POSTS_DIR, '..', '..', '..', 'data', 'visual-audit.json'), 'utf8'));
  for (const v of Object.values(va)) if (v && v.verdict === 'MISMATCH' && v.slug) VMISMATCH.add(v.slug);
} catch { /* audit file optional */ }

const candidates = [];
for (const f of files) {
  const src = await readFile(join(POSTS_DIR, f), 'utf8');
  const id = placeId(src);
  if (!id) { noplace++; continue; }                       // placeless post
  const hero = heroUrl(src);
  if (hero.includes('/venue-photos/')) { already++; continue; } // done already
  let flagged = 1;
  try {
    if (VMISMATCH.has(f.replace(/\.md$/, '')) || OFFTOPIC.test(decodeURIComponent(hero))) flagged = 0;
  } catch { /* keep 1 */ }
  candidates.push({ f, src, id, flagged });
}
candidates.sort((a, b) => a.flagged - b.flagged); // mismatched heroes first

for (const { f, src, id } of candidates) {
  if (done >= LIMIT) break;
  const path = join(POSTS_DIR, f);

  let place;
  try {
    place = await getPlaceById(id, { throwOnQuota: true, throwOnError: true });
  } catch (e) {
    const m = e.message || '';
    if (/\b429\b|RESOURCE_EXHAUSTED|Quota exceeded/i.test(m)) {
      console.log(`⛔ Places Details quota — stopping; next run resumes. Raw: ${m.slice(0, 220)}`);
      break;
    }
    // A permission / not-enabled / bad-request error will repeat for every post —
    // stop immediately and surface the exact reason instead of failing 200 times.
    if (/\b40[03]\b|PERMISSION_DENIED|SERVICE_DISABLED|API_KEY|not enabled/i.test(m)) {
      console.log(`⛔ Place Details rejected — stopping. Reason: ${m.slice(0, 200)}`);
      break;
    }
    console.log(`  ⚠️  details error ${f}: ${m.slice(0, 100)}`); failed++; continue;
  }
  if (!place?.photos?.length) { console.log(`  ✗ no Places photo: ${f}`); failed++; continue; }

  let hosted = null;
  try { hosted = await selfHostPlacePhoto(place, { used }); } catch { /* fall through */ }
  if (!hosted) { console.log(`  ✗ download failed: ${f}`); failed++; continue; }

  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  const block =
    `heroImage:${nl}  url: ${JSON.stringify(hosted.url)}${nl}  credit: ${JSON.stringify(hosted.credit)}${nl}` +
    `  license: ${JSON.stringify(hosted.license)}${nl}  source: ${JSON.stringify(hosted.source)}`;
  const next = src.replace(/heroImage:\r?\n {2}url:.*\r?\n {2}credit:.*\r?\n {2}license:.*\r?\n {2}source:.*/, block);
  if (next === src) { console.log(`  ⚠️  no heroImage block matched: ${f}`); failed++; continue; }
  await writeFile(path, next, 'utf8');
  done++;
  console.log(`  ✅ ${f} → ${hosted.url}`);
}
console.log(`\nDone. Self-hosted ${done}, already-done ${already}, placeless ${noplace}, failed ${failed}.`);
