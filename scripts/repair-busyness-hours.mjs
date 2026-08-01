// One-off/idempotent: clamp every post's STORED busyness quiet/busy hours to
// the venue's stored opening hours. The 2026-08-01 audit found 57 live posts
// advertising a quiet/busy window at or after closing (andong-hahoe-folk-village:
// closes 6 PM, weekendQuiet listed 18h) — BestTime measures the pavement, not
// the business, and the old backfill saved its forecast unclamped.
//
// Data-layer fix only: no API calls, no credits, prose untouched. Posts whose
// opening hours are absent or unparseable are left exactly as they are
// (unknown is not closed). Drafts are included — quarantined posts republish.
//
//   node scripts/repair-busyness-hours.mjs           # dry-run (report only)
//   node scripts/repair-busyness-hours.mjs --apply   # write changes
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clampBusynessInRaw } from './lib/busyness-clamp.mjs';

const DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const APPLY = process.argv.includes('--apply');

const files = (await readdir(DIR)).filter((f) => f.endsWith('.md'));
let changed = 0, clean = 0, shapeWarnings = 0;

for (const f of files) {
  const p = join(DIR, f);
  const raw = await readFile(p, 'utf8');
  const res = clampBusynessInRaw(raw);
  const unrecognized = res.notes.filter((n) => n.includes('UNRECOGNIZED'));
  if (unrecognized.length) {
    shapeWarnings++;
    console.log(`  ⚠ ${f}: ${unrecognized.join('; ')}`);
  }
  if (!res.changed) { clean++; continue; }
  changed++;
  console.log(`  ✓ ${f}`);
  for (const n of res.notes) console.log(`      ${n}`);
  if (APPLY) await writeFile(p, res.raw, 'utf8');
}

console.log(
  `\n${changed} post(s) clamped, ${clean} already inside opening hours` +
  (shapeWarnings ? `, ${shapeWarnings} with an unrecognized YAML shape (left untouched)` : '') +
  ` (${APPLY ? 'APPLIED' : 'dry-run'}).`
);
