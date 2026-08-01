// One-off/idempotent: add real foot-traffic quiet/busy hours (BestTime.app) to
// existing venue posts. New posts get this inline from generate.mjs; this
// backfills the rest. ONE New Forecast per venue (2 credits), cached into the
// `place.busyness` frontmatter. Honest data only: venues BestTime can't forecast
// are skipped (no fabricated hours). Posts already carrying busyness are skipped.
//
//   node scripts/backfill-busyness.mjs                 # dry-run (still forecasts to preview)
//   node scripts/backfill-busyness.mjs --apply         # write changes
//   node scripts/backfill-busyness.mjs --limit 10      # cap posts (credit-safe trial)
import './lib/env.mjs'; // loads .env (BESTTIME_API_KEY) before besttime.mjs reads it
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { fetchBusyness } from './lib/besttime.mjs';
import { clampBusynessHours } from '../src/lib/hours.mjs';

const DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const APPLY = process.argv.includes('--apply');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i !== -1 ? Number(process.argv[i + 1]) : Infinity;
})();

if (!process.env.BESTTIME_API_KEY) {
  console.error('❌ BESTTIME_API_KEY not set in .env — add your private key (pri_…) first.');
  process.exit(1);
}

const yq = (s) => `'${String(s).replace(/'/g, "''")}'`;
const arr = (xs) => `[${xs.join(', ')}]`;
const today = new Date().toISOString().slice(0, 10);

const files = (await readdir(DIR)).filter((f) => f.endsWith('.md'));
let updated = 0, skipNoPlace = 0, already = 0, noData = 0, processed = 0;

for (const f of files) {
  if (processed >= LIMIT) break;
  const p = join(DIR, f);
  const t = await readFile(p, 'utf8');

  const block = t.match(/^place:\r?\n((?:[ ]{2}.*\r?\n)+)/m);
  if (!block) { skipNoPlace++; continue; }
  const body = block[1];
  const clean = (v) => v?.replace(/[\r\n]+$/, '').trim().replace(/^['"]|['"]$/g, '');
  const name = clean(body.match(/^[ ]{2}name:[ \t]*(.+)/m)?.[1]);
  const address = clean(body.match(/^[ ]{2}address:[ \t]*(.+)/m)?.[1]);
  if (!name || !address) { skipNoPlace++; continue; }
  if (/^[ ]{2}busyness:/m.test(body)) { already++; continue; }

  processed++;
  let bz;
  try { bz = await fetchBusyness(name, address); }
  catch (e) { console.log(`  ⚠ ${f}: ${e.message}`); continue; }
  if (!bz) { noData++; console.log(`  – ${f}: no forecast`); continue; }

  // Clamp to the venue's stored opening hours before saving: BestTime measures
  // the pavement, not the business, and an unclamped window put "weekend quiet:
  // 6–7 PM" on a page whose fact box says the doors shut at 6. Unparseable or
  // absent hours → keep the forecast as fetched (unknown is not closed).
  let hours;
  try { hours = yaml.load(t.slice(4, t.indexOf('\n---', 3)))?.place?.openingHours; } catch { /* keep bz */ }
  const use = clampBusynessHours(bz, hours) ?? bz;

  // Build the nested busyness block (only non-empty hour lists). The venueId is
  // written even when the clamp leaves nothing: the credits are spent, and the
  // block's presence stops a later run from buying the same forecast again.
  let inject = `  busyness:\n    updated: ${yq(today)}\n`;
  if (use.weekdayQuiet.length) inject += `    weekdayQuiet: ${arr(use.weekdayQuiet)}\n`;
  if (use.weekdayBusy.length)  inject += `    weekdayBusy: ${arr(use.weekdayBusy)}\n`;
  if (use.weekendQuiet.length) inject += `    weekendQuiet: ${arr(use.weekendQuiet)}\n`;
  if (use.weekendBusy.length)  inject += `    weekendBusy: ${arr(use.weekendBusy)}\n`;
  if (bz.venueId) inject += `    venueId: ${yq(bz.venueId)}\n`;

  updated++;
  const clampNote = use.changed ? ' (clamped to opening hours)' : '';
  console.log(`  ✓ ${f}  wd-quiet:${arr(use.weekdayQuiet)} wd-busy:${arr(use.weekdayBusy)}${clampNote}`);

  if (APPLY) {
    // Match the file's own line ending so we don't mix CRLF/LF inside the block.
    const nl = body.includes('\r\n') ? '\r\n' : '\n';
    const injectNl = inject.replace(/\n/g, nl);
    const out = t.replace(/^place:\r?\n(?:[ ]{2}.*\r?\n)+/m, `place:${nl}${body}${injectNl}`);
    if (out !== t) await writeFile(p, out, 'utf8');
  }
}

console.log(
  `\n${updated} updated, ${already} already had busyness, ${skipNoPlace} no place name/address, ` +
  `${noData} no forecast (${APPLY ? 'APPLIED' : 'dry-run'}).`
);
