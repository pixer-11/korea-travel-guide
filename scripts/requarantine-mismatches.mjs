#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  RE-QUARANTINE: the verdict store gets the last word, mechanically.
//
//  2026-08-08: three venue posts went live wearing the EXACT photo the audit
//  had judged wrong the day before — the dawn patrol's commit removed only
//  their `draft: true` line (no photo change), because a re-verification of
//  the same image happened to pass. Vision verdicts are not deterministic at
//  the margin, so any path that re-judges a stored MISMATCH can eventually
//  flip it. validate-content already NAMES this state (UNQUARANTINED-
//  MISMATCH) but only warns.
//
//  This tool enforces it: any published post whose CURRENT hero URL carries a
//  MISMATCH verdict in data/visual-audit.json goes back to draft. Runs inside
//  alt-photos.yml right before the commit, so no pipeline — present or future
//  — can ship this state, whatever code path produced it. An acquittal is
//  still possible, but only by the audit path that OVERWRITES the verdict
//  (patrol re-check writes MATCH), never by a lucky re-roll that leaves the
//  MISMATCH standing.
//
//    node scripts/requarantine-mismatches.mjs        # apply
//    DRY=1 node scripts/requarantine-mismatches.mjs  # report only
// ─────────────────────────────────────────────────────────────
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMeasurementFailure } from './lib/audit-verdict.mjs';
import { identityRejection } from './lib/photo-verdict.mjs';
import matter from 'gray-matter';

const POSTS = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const STORE = fileURLToPath(new URL('../data/visual-audit.json', import.meta.url));
const DRY = process.env.DRY === '1';

if (!existsSync(STORE)) { console.log('no verdict store — nothing to enforce'); process.exit(0); }
const store = JSON.parse(await readFile(STORE, 'utf8'));

let requarantined = 0;
for (const f of (await readdir(POSTS)).filter((x) => x.endsWith('.md'))) {
  const p = join(POSTS, f);
  const raw = await readFile(p, 'utf8');
  let data;
  try { ({ data } = matter(raw)); } catch { continue; }
  if (data.draft === true) continue;
  const url = data.heroImage?.url;
  if (!url) continue;
  const slug = f.replace(/\.md$/, '');
  const exact = store[`${slug}\x01${url}`];
  // A row that records a failed download is not a judgement about the photo;
  // the weekly prune forgets it, but this runs nightly and must not act on it
  // in between (a 429 at 04:35 would otherwise unpublish a correct page).
  const judged = exact && /MISMATCH/.test(String(exact.verdict)) && !isMeasurementFailure(exact) ? exact : null;
  // The store is keyed by the exact URL, and one photo has had several: the
  // same Commons file started arriving on thumb.wikimedia.org on 2026-08-31
  // and under a second thumbnail width, so a rejection recorded against one
  // key said nothing about the other — and vision, which cannot see identity,
  // put a Hong Kong congee shop back on a Gardena restaurant guide. An
  // identity-grade rejection follows the FILE.
  const v = judged || identityRejection(store, slug, url, data.category);
  if (!v) continue;
  requarantined++;
  console.log(`  🚫 ${slug}: live with a stored-MISMATCH hero (${v.reasonKo || v.reason}) — re-quarantining`);
  if (!DRY) {
    // Insert draft: true just before the closing frontmatter fence, preserving
    // the file's own line endings.
    const i = raw.indexOf('---', 3);
    const nl = raw.slice(0, i).includes('\r\n') ? '\r\n' : '\n';
    await writeFile(p, raw.slice(0, i) + `draft: true${nl}` + raw.slice(i), 'utf8');
  }
}
console.log(`\n⚖️  requarantine sweep: ${requarantined} post(s)${DRY ? ' (DRY)' : ''} — the stored verdict outranks a lucky re-roll`);
