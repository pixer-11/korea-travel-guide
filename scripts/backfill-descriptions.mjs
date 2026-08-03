// One-off/idempotent: regenerate meta `description` for existing posts from
// their quickAnswer, using the SHARED rules in lib/serp.mjs — the sentence-
// boundary clip (no dangling "…") plus the honest review-intent signal
// ("4.9★ (1,961 reviews) — what visitors say, hours, and tips.") for venue
// posts whose stored Google rating clears the strongRating bar. This file
// previously carried its own stale copy of clip(); it now imports the same
// one generate.mjs uses, so the two can never drift again.
//   node scripts/backfill-descriptions.mjs                       # dry-run, all posts
//   node scripts/backfill-descriptions.mjs --apply               # apply, all posts
//   node scripts/backfill-descriptions.mjs --only=slug-a,slug-b  # limit to these slugs
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clip, withRatingSignal } from './lib/serp.mjs';

const DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '')
  .replace('--only=', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const files = (await readdir(DIR)).filter(
  (f) => f.endsWith('.md') && (!ONLY.length || ONLY.includes(f.replace(/\.md$/, '')))
);
let changed = 0, skip = 0;
for (const f of files) {
  const p = join(DIR, f);
  const t = await readFile(p, 'utf8');
  // Rating facts for the review-intent signal — read from the stored place
  // block only (never invented; posts without one just get no signal).
  const place = {
    rating: t.match(/^[ \t]+rating:[ \t]*([\d.]+)/m)?.[1],
    userRatingsTotal: t.match(/^[ \t]+userRatingsTotal:[ \t]*(\d+)/m)?.[1],
  };
  const oldDesc = t
    .match(/^description:[ \t]*(.+)/m)?.[1]
    ?.replace(/^["']|["']$/g, '')
    .replace(/\\"/g, '"')
    .trim();
  const qaRaw = t.match(/^quickAnswer:[ \t]*(.+)/m)?.[1];
  const qa = qaRaw
    ? qaRaw.replace(/[\r\n]+$/, '').replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim()
    : '';
  // Re-derive from quickAnswer ONLY when the stored description is unhealthy
  // (dangling mid-clause). A healthy description stays as-is — re-clipping it
  // is what turned bandung-wheels' full first sentence into "…Martadinata No."
  // (clip reads the "No. 65" abbreviation as a sentence end). Either way the
  // rating signal can still be appended.
  const healthy = oldDesc && /[.!?…](['"”’)\]]*)?$/.test(oldDesc);
  const base = qa && !healthy ? clip(qa) : oldDesc;
  if (!base) { skip++; continue; }
  const newDesc = withRatingSignal(base, place);
  if (newDesc === oldDesc) { skip++; continue; }
  const out = t.replace(/^description:[ \t]*.+/m, `description: ${JSON.stringify(newDesc)}`);
  if (out === t) { skip++; continue; }
  changed++;
  if (changed <= 8) console.log(`  ✓ ${f}\n     → ${newDesc}`);
  if (APPLY) await writeFile(p, out, 'utf8');
}
console.log(`\n${changed} descriptions rewritten, ${skip} unchanged (${APPLY ? 'APPLIED' : 'dry-run'}).`);
