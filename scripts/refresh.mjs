#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  FRESHNESS JOB — keeps existing posts up to date.
//  Re-checks each post's venue against Google Places and:
//    • updates rating, review count, price, address
//    • stamps updatedDate (a real "freshness" signal for SEO/AI)
//    • AUTO-UNPUBLISHES venues that are no longer OPERATIONAL
//      (sets draft: true) — so the site never recommends a closed place.
//
//  Runs unattended. Without keys it reports what it would do and exits.
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POSTS_DIR = join(__dirname, '..', 'src', 'content', 'posts');

const HAS_KEYS = !!process.env.GOOGLE_MAPS_API_KEY;
const today = new Date().toISOString().slice(0, 10);

async function main() {
  const files = (await readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'));
  console.log(`\n🔄  Freshness job — ${files.length} post(s) · ${HAS_KEYS ? 'LIVE' : 'DRY-RUN (no key)'}`);

  if (!HAS_KEYS) {
    console.log('  ℹ️  Set GOOGLE_MAPS_API_KEY to refresh live data. Nothing changed.\n');
    return;
  }
  const { getPlaceById } = await import('./lib/places.mjs');

  let updated = 0, unpublished = 0;
  for (const file of files) {
    const full = join(POSTS_DIR, file);
    const parsed = matter(await readFile(full, 'utf8'));
    const place = parsed.data.place;
    if (!place?.id) continue;

    const fresh = await getPlaceById(place.id);
    if (!fresh) { console.log(`  ⏭️   ${file} — could not fetch`); continue; }

    let changed = false;
    for (const key of ['rating', 'userRatingsTotal', 'priceLevel', 'address', 'businessStatus']) {
      if (fresh[key] !== undefined && fresh[key] !== place[key]) { place[key] = fresh[key]; changed = true; }
    }

    if (fresh.businessStatus && fresh.businessStatus !== 'OPERATIONAL' && !parsed.data.draft) {
      parsed.data.draft = true; // auto-unpublish closed venues
      changed = true;
      unpublished++;
      console.log(`  🚫  unpublished (${fresh.businessStatus}): ${file}`);
    }

    if (changed) {
      parsed.data.updatedDate = today;
      await writeFile(full, matter.stringify(parsed.content, parsed.data), 'utf8');
      updated++;
      console.log(`  ✅  refreshed: ${file}`);
    }
  }
  console.log(`\n📦  Done. ${updated} updated, ${unpublished} unpublished.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
