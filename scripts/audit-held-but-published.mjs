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
// A file this check could not read is a file it did not check. Both of these
// were `continue` — a post with broken YAML, or with no frontmatter at all,
// slipped past silently, and a hold hidden behind a syntax error is exactly the
// hold that would stay live. Counted, listed, and failed on.
const unreadable = [];
let held = 0;
let posts = 0;

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.md'))) {
  posts++;
  const raw = readFileSync(join(DIR, file), 'utf8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) { unreadable.push(`${file} — no frontmatter block`); continue; }
  let fm;
  try { fm = yaml.load(m[1]); } catch (err) {
    unreadable.push(`${file} — frontmatter does not parse: ${String(err.message).split('\n')[0]}`);
    continue;
  }
  if (!fm?.heldReason) continue;
  held++;
  if (fm.draft !== true) hits.push({ file, reason: String(fm.heldReason) });
}

console.log(`${held} post(s) carry a hold; ${hits.length} of them are still published`);
for (const h of hits) console.log(`HELD-BUT-PUBLISHED: ${h.file} — heldReason: ${h.reason}, but draft is not true`);

for (const u of unreadable) console.log(`HELD-BUT-PUBLISHED: ${u}`);

if (hits.length) {
  console.log('\nA hold means the page must not be live. Set draft: true, or clear the reason deliberately.');
  process.exit(1);
}
if (unreadable.length) {
  console.log(`\n${unreadable.length} post(s) could not be read, so they were not checked. Unreadable is not clean.`);
  process.exit(1);
}
// Reading zero posts means the content path moved, not that the site emptied.
if (!posts) {
  console.log(`HELD-BUT-PUBLISHED: no posts found under ${DIR} — nothing was checked.`);
  process.exit(1);
}
console.log('✓ every held post is unpublished.');
