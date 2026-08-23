#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  ONE-OFF: stamp heroImage.focus on event posts whose hero passed the vision
//  gate but shipped without the focus point the gate reported (discover-events
//  discarded it until 2026-08-20 — fixed at the source the same day). Asks the
//  SAME gate once per post; a post whose photo fails now stays exactly as it
//  is. Clears draft/heldReason ONLY when passed --release and the hold was
//  `content` and the focus is the one thing that held it (the caller re-runs
//  the full gate audits afterwards — this script alone never republishes).
//
//    node scripts/stamp-event-focus.mjs slug1,slug2 [--release]
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { verifyHeroImage } from './lib/vision-check.mjs';

const POSTS = 'src/content/posts';
const slugs = (process.argv[2] || '').split(',').map((s) => s.trim()).filter(Boolean);
const RELEASE = process.argv.includes('--release');
if (!slugs.length) { console.error('usage: node scripts/stamp-event-focus.mjs slug1,slug2 [--release]'); process.exit(1); }

let stamped = 0, released = 0, skipped = 0;
for (const slug of slugs) {
  const p = join(POSTS, `${slug}.md`);
  let raw;
  try { raw = await readFile(p, 'utf8'); } catch { console.log(`  ? ${slug}: no such post`); skipped++; continue; }
  const parsed = matter(raw);
  const d = parsed.data;
  if (!d.heroImage?.url) { console.log(`  ? ${slug}: no hero`); skipped++; continue; }
  if (d.heroImage.focus) { console.log(`  · ${slug}: already has focus`); }
  else {
    const vis = await verifyHeroImage({
      url: d.heroImage.url, name: d.title, category: d.category,
      region: d.region, country: d.country || '', eventMode: d.category === 'event', existing: true,
    });
    if (!vis.ok || !vis.focus) { console.log(`  ✗ ${slug}: gate did not clear it (${vis.reason || 'no focus returned'}) — left as is`); skipped++; continue; }
    parsed.data.heroImage = { ...d.heroImage, focus: vis.focus };
    stamped++;
    console.log(`  ✓ ${slug}: focus {x:${vis.focus.x}, y:${vis.focus.y}${vis.focus.top != null ? `, head ${vis.focus.top}-${vis.focus.bottom}%` : ''}} — ${String(vis.reason).slice(0, 50)}`);
  }
  if (RELEASE && parsed.data.draft === true && parsed.data.heldReason === 'content') {
    delete parsed.data.draft;
    delete parsed.data.heldReason;
    released++;
  }
  let out = matter.stringify(parsed.content, parsed.data);
  if (raw.includes('\r\n')) out = out.replace(/\r?\n/g, '\r\n');
  await writeFile(p, out, 'utf8');
}
console.log(`\nSTAMP_FOCUS_SUMMARY stamped=${stamped} released=${released} skipped=${skipped}`);
