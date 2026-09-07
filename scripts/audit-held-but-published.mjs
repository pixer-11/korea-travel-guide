#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  A HELD POST THAT IS STILL PUBLISHED
//
//  `heldReason` means someone decided this post must not be live: the show was
//  cancelled, the event already happened, the region is wrong, the article is a
//  duplicate. It is only ever written next to `draft: true`. The pair is the
//  whole mechanism, and nothing checked that the pair held together.
//
//  On 2026-08-23 two event guides were unpublished with named holds — Christina
//  Aguilera Abu Dhabi (the organiser cancelled it) and Tokyo Tyler, the Creator
//  (the shows were in 2025). The photo patrol republished both the same day,
//  before its guard learned those reasons. They then sat live for fifteen days
//  telling readers a cancelled concert was going ahead, and on 2026-09-07 the
//  social picker chose one and posted it to Threads and Instagram.
//
//  Every layer had a reason not to see it: the post was not a draft, so the
//  draft audits skipped it; its hero was fine, so the photo audits skipped it;
//  its prose was fine, so the content validator passed it. Only the CONTRADICTION
//  was visible, and nothing was looking at the contradiction.
//
//    node scripts/audit-held-but-published.mjs
// ─────────────────────────────────────────────────────────────
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

const DIR = 'src/content/posts';
const hits = [];
let held = 0;

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.md'))) {
  const raw = readFileSync(join(DIR, file), 'utf8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) continue;
  let fm;
  try { fm = yaml.load(m[1]); } catch { continue; }
  if (!fm?.heldReason) continue;
  held++;
  if (fm.draft !== true) hits.push({ file, reason: String(fm.heldReason) });
}

console.log(`${held} post(s) carry a hold; ${hits.length} of them are still published`);
for (const h of hits) console.log(`HELD-BUT-PUBLISHED: ${h.file} — heldReason: ${h.reason}, but draft is not true`);

if (hits.length) {
  console.log('\nA hold means the page must not be live. Set draft: true, or clear the reason deliberately.');
  process.exit(1);
}
console.log('✓ every held post is unpublished.');
