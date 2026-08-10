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
import yaml from 'js-yaml';
import { clip, withRatingSignal } from './lib/serp.mjs';
import { bracketsBalanced, endsInAbbreviation } from '../src/lib/sentence-boundary.mjs';

const DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const APPLY = process.argv.includes('--apply');
// Repair mode: fix descriptions that were CLIPPED wrong, and touch nothing
// else. Without this the script also adds the review badge to every eligible
// post — 437 of them as of 2026-08-10 — which would wipe out the control group
// of the SERP review-badge pilot before its 2026-08-17 re-measurement. Each
// post keeps the badge state it already has.
const FIX_TRUNCATED_ONLY = process.argv.includes('--fix-truncated-only');
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
  // Read the frontmatter with the YAML parser, not line regexes. Most posts
  // store description and quickAnswer as BLOCK SCALARS ("description: >-"
  // followed by indented lines) — a `^description:[ \t]*(.+)` capture returns
  // the literal ">-" for those, and the rewrite below would then have replaced
  // the whole description with ">- 4.6★ (3,074 reviews) — …". 443 of 745 posts
  // were in range of that (dry-run, 2026-08-10); the script had simply never
  // been run with --apply since block scalars appeared.
  const cutIdx = t.indexOf('\n---', 3);
  let fm;
  try { fm = yaml.load(t.slice(4, cutIdx)); } catch { skip++; continue; }
  if (!fm || typeof fm !== 'object') { skip++; continue; }
  // Rating facts for the review-intent signal — read from the stored place
  // block only (never invented; posts without one just get no signal).
  const place = { rating: fm.place?.rating, userRatingsTotal: fm.place?.userRatingsTotal };
  const oldDesc = typeof fm.description === 'string' ? fm.description.replace(/\s+/g, ' ').trim() : '';
  const qa = typeof fm.quickAnswer === 'string' ? fm.quickAnswer.replace(/\s+/g, ' ').trim() : '';
  // Re-derive from quickAnswer ONLY when the stored description is unhealthy.
  // "Unhealthy" used to mean just "dangling mid-clause", because re-clipping a
  // healthy description was what turned bandung-wheels' full first sentence
  // into "…Martadinata No." — clip read the "No. 65" abbreviation as a
  // sentence end. That is fixed at the source now (src/lib/sentence-boundary
  // .mjs), so the two shapes it used to produce — an unclosed bracket, or a
  // stop on an abbreviation — count as unhealthy and get re-derived instead of
  // being preserved forever. Either way the rating signal can still be
  // appended.
  const healthy = oldDesc
    && /[.!?…](['"”’)\]]*)?$/.test(oldDesc)
    && bracketsBalanced(oldDesc)
    && !endsInAbbreviation(oldDesc);
  if (FIX_TRUNCATED_ONLY && healthy) { skip++; continue; }
  const base = qa && !healthy ? clip(qa) : oldDesc;
  if (!base) { skip++; continue; }
  // In repair mode a post that had no badge stays without one; a post that had
  // one keeps it (re-derived from quickAnswer, the badge is no longer in the
  // text, so it has to be re-appended from the same stored numbers).
  const hadBadge = /★|\breviews?\b/i.test(oldDesc);
  const newDesc = withRatingSignal(base, FIX_TRUNCATED_ONLY && !hadBadge ? null : place);
  if (newDesc === oldDesc) { skip++; continue; }
  // Replace the whole description entry — a plain scalar line, or a block
  // scalar header plus every indented line under it.
  const DESC_ENTRY = /^description:[ \t]*(?:[>|][-+]?[ \t]*\r?\n(?:[ \t]+[^\n]*\r?\n)*|[^\n]*\r?\n)/m;
  if (!DESC_ENTRY.test(t)) { skip++; continue; }
  const out = t.replace(DESC_ENTRY, `description: ${JSON.stringify(newDesc)}\n`);
  if (out === t) { skip++; continue; }
  // Read it back before trusting it: a bad splice here silently corrupts
  // frontmatter for every downstream build and translation.
  let check;
  try { check = yaml.load(out.slice(4, out.indexOf('\n---', 3))); } catch { check = null; }
  if (!check || check.description !== newDesc || check.title !== fm.title) {
    console.log(`  ⚠️  ${f} — rewrite did not read back cleanly, left alone`);
    skip++; continue;
  }
  changed++;
  if (changed <= 8) console.log(`  ✓ ${f}\n     → ${newDesc}`);
  if (APPLY) await writeFile(p, out, 'utf8');
}
console.log(`\n${changed} descriptions rewritten, ${skip} unchanged (${APPLY ? 'APPLIED' : 'dry-run'}).`);
