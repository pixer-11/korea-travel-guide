#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  EVENT HERO BACK-AUDIT
//
//  The 2026-08-07 four-axis audit found the one hole in photo coverage: 51
//  published EVENT heroes with no verdict in data/visual-audit.json. 47 were
//  published before the event vision gate existed (2026-08-01, e62c15f2);
//  4 passed the gate but the gate never wrote its verdict anywhere. The
//  nightly visual audit skips events BY DESIGN (venue rules would reject an
//  honest concert photo), so nothing would ever close this gap on its own.
//
//  This judges those heroes with the SAME event-mode rules the publish gate
//  uses (lib/vision-check.mjs verifyHeroImage eventMode:true — a performer
//  photo taken anywhere is correct) and stores the verdict in the same store
//  the nightly audit uses. A rejected hero is REMOVED, not quarantined:
//  events are allowed to publish photoless, exactly what the gate does at
//  publish time ("publishing without hero").
//
//    node scripts/audit-event-heroes.mjs --dry     # judge, print, change nothing
//    node scripts/audit-event-heroes.mjs           # judge, record, strip rejects
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { verifyHeroImage } from './lib/vision-check.mjs';

const POSTS = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const STORE = fileURLToPath(new URL('../data/visual-audit.json', import.meta.url));
const DRY = process.argv.includes('--dry');

const store = existsSync(STORE) ? JSON.parse(await readFile(STORE, 'utf8')) : {};
const files = (await readdir(POSTS)).filter((f) => f.endsWith('.md'));

let judged = 0, ok = 0, rejected = 0, failed = 0;
for (const f of files) {
  const p = join(POSTS, f);
  const raw = await readFile(p, 'utf8');
  let data;
  try { ({ data } = matter(raw)); } catch { continue; }
  if (data.draft === true || data.category !== 'event') continue;
  const url = data.heroImage?.url;
  if (!url) continue;
  const slug = f.replace(/\.md$/, '');
  const key = `${slug}\x01${url}`;
  if (store[key]) continue; // already judged (nightly store or a prior run)

  judged++;
  const v = await verifyHeroImage({
    url,
    name: data.title,
    category: 'event',
    region: data.region,
    country: data.country,
    eventMode: true,
    existing: true,
  });
  if (v.ok) {
    ok++;
    console.log(`  ✓ ${slug}: MATCH (event-mode)`);
    if (!DRY) store[key] = { slug, verdict: 'MATCH', reason: `event-mode back-audit: ${v.reason || 'accepted'}`, at: new Date().toISOString() };
  } else if (/vision unavailable|no-api-key|vision check failed/i.test(v.reason || '')) {
    // Transport failure, not a judgement — do not store, do not strip.
    failed++;
    console.log(`  ⚠️  ${slug}: ${v.reason}`);
  } else {
    rejected++;
    console.log(`  ✗ ${slug}: REJECT — ${v.reason}`);
    if (!DRY) {
      store[key] = { slug, verdict: 'MISMATCH', reason: `event-mode back-audit: ${v.reason}`, at: new Date().toISOString() };
      // Same policy as the publish gate: the event stays live, the hero goes.
      // heroImage is a top-level frontmatter block; strip it and its children.
      const out = raw.replace(/^heroImage:(?:\r?\n(?:[ \t]+.*)?)*\r?\n?/m, '');
      if (out !== raw) await writeFile(p, out, 'utf8');
      else console.log(`     ⚠️ could not strip heroImage block — fix by hand`);
    }
  }
}
if (!DRY) await writeFile(STORE, JSON.stringify(store, null, 2), 'utf8');
console.log(`\n📸 event back-audit: ${judged} judged · ${ok} ok · ${rejected} rejected${rejected && !DRY ? ' (heroes stripped)' : ''} · ${failed} unreadable (left unjudged)${DRY ? ' · DRY' : ''}`);
