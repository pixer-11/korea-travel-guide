#!/usr/bin/env node
// Fix PLACELESS mismatched heroes (posts with no place.id, flagged MISMATCH by
// visual-audit): Google-Places TEXT SEARCH the venue by name+city, and if a
// confident match with a photo is found, swap the hero to that real venue photo.
// Guarded by a name-token overlap check so a wrong venue's photo is never used.
// Resumable + quota-aware (stops on 429). Reads data/visual-mismatch-placeless.txt.
//
//   node scripts/attach-placeless-photos.mjs               # dry-run
//   node scripts/attach-placeless-photos.mjs --apply       # write changes
//   node scripts/attach-placeless-photos.mjs --apply --limit 15
import './lib/env.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { searchPlaces, getPlaceById } from './lib/places.mjs';
import { selfHostPlacePhoto } from './lib/images.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = join(ROOT, 'src', 'content', 'posts');
const LIST = join(ROOT, 'data', 'visual-mismatch-placeless.txt');
const APPLY = process.argv.includes('--apply');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > -1 ? Number(process.argv[i + 1]) : Infinity; })();

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
// The search result must share a meaningful chunk of the venue name, or we skip
// (never attach a wrong venue's photo).
function nameMatches(ours, theirs) {
  const a = new Set(norm(ours));
  const b = norm(theirs);
  if (!a.size || !b.length) return false;
  const hit = b.filter((w) => a.has(w)).length;
  return hit >= Math.min(2, a.size); // ≥2 shared tokens (or all, if the name is short)
}

async function usedUrls() {
  const { readdir } = await import('node:fs/promises');
  const urls = new Set();
  for (const f of await readdir(POSTS_DIR)) {
    if (!f.endsWith('.md')) continue;
    const m = (await readFile(join(POSTS_DIR, f), 'utf8')).match(/heroImage:\r?\n {2}url:\s*"?([^"\n]+?)"?\s*$/m);
    if (m) urls.add(m[1].trim());
  }
  return urls;
}

if (!existsSync(LIST)) { console.error(`missing ${LIST} — run visual-audit first`); process.exit(1); }
const slugs = (await readFile(LIST, 'utf8')).trim().split('\n').map((s) => s.trim()).filter(Boolean);
const used = await usedUrls();
let fixed = 0, skipped = 0, nomatch = 0;

for (const slug of slugs) {
  if (fixed >= LIMIT) break;
  const path = join(POSTS_DIR, `${slug}.md`);
  if (!existsSync(path)) { console.log(`  ? missing ${slug}`); continue; }
  const src = await readFile(path, 'utf8');
  const { data } = matter(src);
  if (data.place && data.place.id) { skipped++; continue; } // already has a place → venue-photos handles it
  const name = (data.place && data.place.name) || String(data.title || '').split(/:| in /)[0].trim();
  const query = `${name} ${data.region} ${data.country || ''}`.trim();

  let place;
  try {
    const results = await searchPlaces(query, { max: 3 });
    const cand = (results || []).find((r) => nameMatches(name, r.name || r.displayName));
    if (!cand) { console.log(`  ✗ no confident match: ${slug} (searched "${name}")`); nomatch++; continue; }
    place = await getPlaceById(cand.id || cand.placeId, { throwOnQuota: true, throwOnError: true });
  } catch (e) {
    const m = e.message || '';
    if (/\b429\b|RESOURCE_EXHAUSTED|Quota exceeded/i.test(m)) { console.log(`⛔ Places quota — stopping; resume next run. ${m.slice(0, 120)}`); break; }
    console.log(`  ⚠️  ${slug}: ${m.slice(0, 90)}`); skipped++; continue;
  }
  if (!place || !place.photos || !place.photos.length) { console.log(`  ✗ match has no photo: ${slug}`); nomatch++; continue; }

  let hosted = null;
  try { hosted = await selfHostPlacePhoto(place, { used }); } catch {}
  if (!hosted) { console.log(`  ✗ download failed: ${slug}`); skipped++; continue; }

  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  const block =
    `heroImage:${nl}  url: ${JSON.stringify(hosted.url)}${nl}  credit: ${JSON.stringify(hosted.credit)}${nl}` +
    `  license: ${JSON.stringify(hosted.license)}${nl}  source: ${JSON.stringify(hosted.source)}`;
  const next = src.replace(/heroImage:\r?\n {2}url:.*\r?\n {2}credit:.*\r?\n {2}license:.*\r?\n {2}source:.*/, block);
  if (next === src) { console.log(`  ⚠️  no heroImage block matched: ${slug}`); skipped++; continue; }
  if (APPLY) await writeFile(path, next, 'utf8');
  used.add(hosted.url);
  fixed++;
  console.log(`  ✅ ${slug} → ${hosted.url}  (matched: ${place.displayName?.text || place.name || '?'})`);
}
console.log(`\nDone. ${APPLY ? 'fixed' : 'would fix'} ${fixed}, no-confident-match ${nomatch}, skipped ${skipped} of ${slugs.length}.`);
