// Daily international-venue QUALITY AUDIT — runs after the Places Details quota
// resets and fixes two classes of defect that only surface for non-English venues:
//   1. Non-Latin `place.address` (Arabic/Thai/Japanese/…) → re-fetch an ENGLISH
//      address via Places Details (languageCode=en).
//   2. Restaurant/café/trendy/hidden-gem posts whose hero is a city/landmark
//      Commons fallback (not the venue's real photo) → replace with the venue's
//      own Google Places photo, self-hosted.
//
// SAFETY (this runs unattended in CI):
//   - Only ever REPLACES with something strictly better (English address only if
//     it's actually Latin; hero only if a real venue photo downloads). On any
//     failure the original is kept — the audit can never make a post worse.
//   - Attraction/event posts are left alone (a landmark shot IS appropriate).
//   - If Details returns 429 (quota not yet propagated), exit 0 immediately so the
//     workflow's next scheduled run retries — this is the "keep checking" behaviour.
//   - CRLF-safe line edits.
//
//   node scripts/quality-audit.mjs           # dry-run (still calls the API to preview)
//   node scripts/quality-audit.mjs --apply   # write changes
import './lib/env.mjs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlaceById } from './lib/places.mjs';
import { selfHostPlacePhoto } from './lib/images.mjs';

const DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const APPLY = process.argv.includes('--apply');
const NON_LATIN = /[؀-ۿ一-鿿가-힣฀-๿Ѐ-ӿ぀-ヿ]/;
const IMG_CATEGORIES = new Set(['restaurant', 'trendy', 'hidden-gem']);

const field = (src, key) =>
  (src.match(new RegExp(`^\\s{2}${key}:[ \\t]*(.+)`, 'm')) || [])[1]?.replace(/[\r\n]+$/, '').trim() || null;
const heroUrl = (src) =>
  (src.match(/heroImage:\r?\n\s{2}url:[ \t]*(.+)/m) || [])[1]?.replace(/[\r\n"']+$/g, '').replace(/^["']/, '').trim() || null;

// Seed used-image set from every post's hero so self-host de-dupes site-wide.
const files = (await readdir(DIR)).filter((f) => f.endsWith('.md'));
const used = new Set();
for (const f of files) {
  const u = heroUrl(await readFile(join(DIR, f), 'utf8'));
  if (u) used.add(u);
}

let fixedAddr = 0, fixedImg = 0, scanned = 0;
const changes = [];

try {
  for (const f of files) {
    const p = join(DIR, f);
    let src = await readFile(p, 'utf8');

    const idRaw = field(src, 'id');
    if (!idRaw) continue;
    const id = idRaw.replace(/^["']|["']$/g, '');
    const category = field(src, 'category') || (src.match(/^category:\s*(.+)/m) || [])[1]?.trim();

    const addr = field(src, 'address') || '';
    const needAddr = NON_LATIN.test(addr);
    const hero = heroUrl(src);
    const needImg = IMG_CATEGORIES.has(category) && hero && !hero.includes('/venue-photos/');

    if (!needAddr && !needImg) continue;
    scanned++;

    // ONE Details call (English) — gives both the English address and photo list.
    const place = await getPlaceById(id, { languageCode: 'en', throwOnQuota: true });
    if (!place) continue;

    const nl = src.includes('\r\n') ? '\r\n' : '\n';

    // 1) English address (only if the re-fetched one is actually Latin).
    if (needAddr && place.address && !NON_LATIN.test(place.address)) {
      const next = src.replace(/^(\s{2}address:[ \t]*).*/m, `$1${JSON.stringify(place.address)}`);
      if (next !== src) { src = next; fixedAddr++; changes.push(`addr  ${f}`); }
    }

    // 2) Real venue photo for food/trendy venues (self-host; keep original on failure).
    if (needImg && place.photos?.length) {
      const hosted = await selfHostPlacePhoto(place, { used });
      if (hosted?.url) {
        const block =
          `heroImage:${nl}  url: ${JSON.stringify(hosted.url)}${nl}  credit: ${JSON.stringify(hosted.credit)}` +
          `${nl}  license: ${JSON.stringify(hosted.license)}${nl}  source: ${JSON.stringify(hosted.source)}`;
        const next = src.replace(
          /heroImage:\r?\n\s{2}url:.*\r?\n\s{2}credit:.*\r?\n\s{2}license:.*\r?\n\s{2}source:.*/,
          block.replace(/\n/g, nl)
        );
        if (next !== src) { src = next; fixedImg++; changes.push(`img   ${f}`); }
      }
    }

    if (APPLY) await writeFile(p, src, 'utf8');
  }
} catch (e) {
  if (/429/.test(e.message)) {
    console.log('⏳ QUOTA_NOT_READY — Places Details still 429; next scheduled run will retry.');
    process.exit(0);
  }
  throw e;
}

console.log(`\nAudit: ${fixedAddr} addresses + ${fixedImg} images fixed (scanned ${scanned}) — ${APPLY ? 'APPLIED' : 'dry-run'}.`);
for (const c of changes) console.log('  ✓', c);
// Machine-readable tail for the workflow's Telegram summary.
console.log(`\nAUDIT_RESULT addr=${fixedAddr} img=${fixedImg}`);
