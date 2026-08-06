#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  VISUAL-AUDIT PRUNE — data/visual-audit.json is the vision gate's memory:
//  one entry per slug␁hero-url, so a photo is never re-checked for free. It
//  only ever grew. 93 of its 1,265 entries pointed at posts that no longer
//  exist (retired, renamed, or never republished), and every workflow that
//  reads the file walks them (found 2026-08-06).
//
//  Removes ONLY entries whose post file is gone. Specifically NOT removed:
//   • drafted/quarantined posts — the file is still there and they can return,
//     and dropping their verdicts would re-spend vision calls to relearn what
//     we already know.
//   • old URLs for a post that still exists — a hero can be swapped back, and
//     the stored verdict is what stops a known-bad photo returning silently.
//
//    node scripts/prune-visual-audit.mjs
//    DRY=1 node scripts/prune-visual-audit.mjs
// ─────────────────────────────────────────────────────────────
import { readFile, writeFile, readdir } from 'node:fs/promises';

const AUDIT = 'data/visual-audit.json';
const POSTS = 'src/content/posts';
const SEP = String.fromCharCode(1);
const DRY = process.env.DRY === '1';

const audit = JSON.parse(await readFile(AUDIT, 'utf8'));
const live = new Set(
  (await readdir(POSTS)).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')),
);

const before = Object.keys(audit).length;
const droppedSlugs = new Set();
const kept = {};
for (const [key, value] of Object.entries(audit)) {
  const slug = key.split(SEP)[0];
  if (live.has(slug)) kept[key] = value;
  else droppedSlugs.add(slug);
}
const after = Object.keys(kept).length;

// A prune that would empty the file is a bug in this script, not a clean-up —
// most likely POSTS resolved to the wrong directory. Refuse rather than wipe
// the vision gate's entire memory.
if (before > 0 && after === 0) {
  console.error('❌ prune would remove EVERY entry — refusing (is src/content/posts readable?)');
  process.exit(1);
}

console.log(`\n🧹 visual-audit: ${before} entry(ies) → ${after} (${before - after} orphaned across ${droppedSlugs.size} missing post(s))`);
[...droppedSlugs].slice(0, 10).forEach((s) => console.log(`   − ${s}`));
if (droppedSlugs.size > 10) console.log(`   … and ${droppedSlugs.size - 10} more`);

if (DRY) { console.log('(DRY — nothing written)'); process.exit(0); }
if (before === after) { console.log('nothing to prune'); process.exit(0); }
await writeFile(AUDIT, JSON.stringify(kept, null, 2) + '\n', 'utf8');
console.log(`📦 written → ${AUDIT}`);
