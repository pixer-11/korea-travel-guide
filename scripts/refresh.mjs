#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  FRESHNESS JOB — keeps existing posts up to date.
//  Re-checks each post's venue against Google Places and:
//    • updates rating, review count, price, address
//    • stamps updatedDate (a real "freshness" signal for SEO/AI)
//    • AUTO-UNPUBLISHES venues that are no longer OPERATIONAL
//      (sets draft: true) — so the site never recommends a closed place.
//
//  Quota discipline (Place Details is hard-capped at ~100/day, shared
//  with publish/backfill):
//    • REFRESH_LIMIT caps Details calls per run (default 40). The env
//      var existed in refresh.yml for weeks before anything read it —
//      every run was unbounded.
//    • data/refresh-cursor.json records WHEN each post was last checked;
//      candidates run oldest-checked-first, so the weekly run rotates
//      through the whole catalogue instead of restarting alphabetically
//      (posts m–z had never been re-checked before the cursor existed).
//    • A 429 stops the run immediately (throwOnQuota) instead of burning
//      the rest of the list on doomed calls.
//
//  Failure rule: a fetch that fails leaves the post UNTOUCHED and its
//  cursor entry unrecorded, so it stays at the front of next run's queue.
//  Only a real API answer can unpublish anything.
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
const CURSOR_PATH = join(__dirname, '..', 'data', 'refresh-cursor.json');

const HAS_KEYS = !!process.env.GOOGLE_MAPS_API_KEY;
const today = new Date().toISOString().slice(0, 10);
// Details calls per run. Default matches refresh.yml; REFRESH_LIMIT=0 is a
// misconfiguration, not "unlimited" — unlimited is how the quota drained before.
const LIMIT = Number(process.env.REFRESH_LIMIT) > 0 ? Number(process.env.REFRESH_LIMIT) : 40;

async function loadCursor() {
  try {
    const c = JSON.parse(await readFile(CURSOR_PATH, 'utf8'));
    return c && typeof c.checked === 'object' && c.checked ? c : { checked: {} };
  } catch {
    return { checked: {} }; // first run, or a corrupt file — start rotating from scratch
  }
}

async function main() {
  const files = (await readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'));
  console.log(`\n🔄  Freshness job — ${files.length} post(s) · limit ${LIMIT} · ${HAS_KEYS ? 'LIVE' : 'DRY-RUN (no key)'}`);

  if (!HAS_KEYS) {
    console.log('  ℹ️  Set GOOGLE_MAPS_API_KEY to refresh live data. Nothing changed.\n');
    return;
  }
  const { getPlaceById } = await import('./lib/places.mjs');
  const cursor = await loadCursor();

  // Candidates = posts with a place.id, oldest-checked-first (never-checked
  // sorts before any date; filename breaks ties so the order is stable).
  const candidates = [];
  for (const file of files) {
    const full = join(POSTS_DIR, file);
    const parsed = matter(await readFile(full, 'utf8'));
    if (parsed.data.place?.id) candidates.push({ file, full, parsed });
  }
  candidates.sort((a, b) =>
    (cursor.checked[a.file] ?? '').localeCompare(cursor.checked[b.file] ?? '') ||
    a.file.localeCompare(b.file)
  );

  let updated = 0, unpublished = 0, checked = 0, quotaStop = false;
  for (const { file, full, parsed } of candidates) {
    if (checked >= LIMIT) break;
    const place = parsed.data.place;

    checked++; // every Details attempt spends quota, successful or not
    let fresh;
    try {
      fresh = await getPlaceById(place.id, { throwOnQuota: true });
    } catch (e) {
      // Quota is a run-level condition, not a per-post one: every further call
      // would fail the same way, so stop and let next week resume from the
      // cursor (this post stays unrecorded and therefore first in line).
      console.log(`\n⛔ Places Details quota hit after ${checked - 1} call(s) — stopping early. ${e.message.slice(0, 120)}`);
      quotaStop = true;
      break;
    }
    if (!fresh) { console.log(`  ⏭️   ${file} — could not fetch (left untouched, will retry next run)`); continue; }
    cursor.checked[file] = today;

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

  // Persist progress even on a quota stop — the posts already checked must not
  // be re-spent next week.
  await writeFile(CURSOR_PATH, JSON.stringify(cursor, null, 2) + '\n', 'utf8');

  const behind = candidates.filter(({ file }) => !cursor.checked[file]).length;
  console.log(`\n📦  Done. checked ${checked - (quotaStop ? 1 : 0)} of ${candidates.length} place post(s) (${behind} never checked), ${updated} updated, ${unpublished} unpublished.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
