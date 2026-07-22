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

const POSTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'content', 'posts');
const LIMIT = Number(process.env.PHOTO_LIMIT || 0) || Infinity; // cap posts per run

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
for (const f of (await readdir(POSTS_DIR)).filter((x) => x.endsWith('.md'))) {
  if (done >= LIMIT) break;
  const path = join(POSTS_DIR, f);
  const src = await readFile(path, 'utf8');

  const id = placeId(src);
  if (!id) { noplace++; continue; }                       // placeless post
  if (heroUrl(src).includes('/venue-photos/')) { already++; continue; } // done already

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
