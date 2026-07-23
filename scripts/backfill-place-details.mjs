// One-off/idempotent: add reservation `phone` + `openingHours` to EXISTING venue
// posts that predate those fields. New posts get them inline from generate.mjs;
// this backfills the rest with ONE Details call per post (real Google Places
// data — never invented). Posts without a place.id, or already carrying phone
// AND hours, are skipped. Leaves prose untouched.
//
//   node scripts/backfill-place-details.mjs                 # dry-run (still calls the API to preview)
//   node scripts/backfill-place-details.mjs --apply         # write changes
//   node scripts/backfill-place-details.mjs --limit 10      # cap posts processed (quota-safe trial)
import './lib/env.mjs'; // MUST be first — loads .env before places.mjs reads the API key
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchPlaceReviewSignals } from './lib/places.mjs';

const DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const APPLY = process.argv.includes('--apply');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i !== -1 ? Number(process.argv[i + 1]) : Infinity;
})();

// YAML single-quote a scalar (only ' needs escaping, as '').
const yq = (s) => `'${String(s).replace(/'/g, "''")}'`;

const files = (await readdir(DIR)).filter((f) => f.endsWith('.md'));
let updated = 0, skipNoPlace = 0, already = 0, noData = 0, processed = 0;

for (const f of files) {
  if (processed >= LIMIT) break;
  const p = join(DIR, f);
  const t = await readFile(p, 'utf8');

  // Isolate the `place:` frontmatter block (top-level key + its 2-space children).
  const block = t.match(/^place:\n((?:[ ]{2}.*\n)+)/m);
  if (!block) { skipNoPlace++; continue; }
  const placeBody = block[1];

  const id = placeBody.match(/^[ ]{2}id:\s*(.+)$/m)?.[1]?.trim();
  if (!id) { skipNoPlace++; continue; }

  const hasPhone = /^[ ]{2}phone:/m.test(placeBody);
  const hasHours = /^[ ]{2}openingHours:/m.test(placeBody);
  if (hasPhone && hasHours) { already++; continue; }

  processed++;
  let raw;
  try {
    raw = await fetchPlaceReviewSignals(id.replace(/^['"]|['"]$/g, ''));
  } catch (e) {
    console.log(`  ⚠ ${f}: ${e.message}`);
    continue;
  }
  const phone = raw?.phone;
  const hours = raw?.openingHours;
  if ((!phone || hasPhone) && (!hours?.length || hasHours)) {
    noData++;
    console.log(`  – ${f}: nothing new`);
    continue;
  }

  // Build the lines to append inside the place block (only what's missing).
  let inject = '';
  if (phone && !hasPhone) inject += `  phone: ${yq(phone)}\n`;
  if (hours?.length && !hasHours) {
    inject += `  openingHours:\n` + hours.map((h) => `    - ${yq(h)}`).join('\n') + '\n';
  }
  if (!inject) { noData++; continue; }

  updated++;
  console.log(`  ✓ ${f}${phone && !hasPhone ? ' +phone' : ''}${hours?.length && !hasHours ? ` +${hours.length}h hours` : ''}`);

  if (APPLY) {
    // Append the new lines to the END of the place block (before the next top-level key).
    const newBlock = `place:\n${placeBody}${inject}`;
    const out = t.replace(/^place:\n(?:[ ]{2}.*\n)+/m, newBlock);
    if (out !== t) await writeFile(p, out, 'utf8');
  }
}

console.log(
  `\n${updated} updated, ${already} already complete, ${skipNoPlace} no place.id, ` +
  `${noData} no new data (${APPLY ? 'APPLIED' : 'dry-run'}).`
);
