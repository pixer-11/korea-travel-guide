#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  ALT-SOURCE PHOTO BACKFILL — clears the mismatched/drafted/placeholder hero
//  backlog in ONE run using Foursquare + Flickr (no Google quota involved).
//  For every target post: pull venue photo candidates → AI VISION gate judges
//  each → first pass replaces the hero (and un-drafts a quarantined post).
//  Posts with no passing candidate are reported for venue-rewrite.
//
//  Targets (any of): draft:true venue posts (photo quarantine), posts listed
//  in data/visual-audit.json VMISMATCH, posts whose hero is a placeholder,
//  or SLUGS env (comma-separated) for a manual priority run.
//  Env: FOURSQUARE_API_KEY / FLICKR_API_KEY (either or both; skips cleanly if
//  neither), ANTHROPIC_API_KEY (vision), LIMIT (default 300), DRY=1.
//  Usage: node scripts/backfill-photos-alt.mjs
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { loadUsedImageUrls, resolveHero } from './lib/images.mjs';
import { venuePhotoCandidates } from './lib/photo-sources.mjs';
import { verifyHeroImage } from './lib/vision-check.mjs';

const POSTS = 'src/content/posts';
const DRY = process.env.DRY === '1';
const LIMIT = Number(process.env.LIMIT ?? 300);
const ONLY = (process.env.SLUGS || '').split(',').map((s) => s.trim()).filter(Boolean);

if (!process.env.FOURSQUARE_API_KEY && !process.env.FLICKR_API_KEY) {
  console.log('No FOURSQUARE_API_KEY / FLICKR_API_KEY set — nothing to do.');
  console.log('ALT_SUMMARY fixed=0 undrafted=0 unfixed=0');
  process.exit(0);
}

const vmismatch = new Set();
if (existsSync('data/visual-audit.json')) {
  try {
    const audit = JSON.parse(readFileSync('data/visual-audit.json', 'utf8'));
    for (const item of audit.results ?? audit ?? []) {
      if ((item.verdict || item.status || '').toUpperCase().includes('MISMATCH') && item.slug) vmismatch.add(item.slug);
    }
  } catch {}
}

const used = await loadUsedImageUrls(POSTS);
const files = (await readdir(POSTS)).filter((f) => f.endsWith('.md'));
let fixed = 0, undrafted = 0, unfixed = 0, scanned = 0;
const rewriteList = [];

for (const f of files) {
  if (fixed + unfixed >= LIMIT) break;
  const slug = f.replace(/\.md$/, '');
  if (ONLY.length && !ONLY.includes(slug)) continue;
  const path = `${POSTS}/${f}`;
  const { data, content } = matter(await readFile(path, 'utf8'));
  if (!data.place?.name) continue; // venue posts only — placeless/events keep their pipeline

  // AUDIT_ALL=1 → EVERY venue post is vision-checked (catches name-collision
  // cases the filename heuristic can't see, e.g. Rolo's restaurant wearing a
  // Rolo-candy photo). Default mode only touches the known backlog.
  const isTarget =
    process.env.AUDIT_ALL === '1' ||
    ONLY.length > 0 ||
    data.draft === true ||
    vmismatch.has(slug) ||
    (data.heroImage?.url || '').includes('placeholder');
  if (!isTarget) continue;
  scanned++;

  // Current hero first: if the AI approves what's already there, keep it.
  if (data.heroImage?.url && data.draft !== true) {
    const cur = await verifyHeroImage({ url: data.heroImage.url, name: data.place.name, category: data.category, region: data.region, country: data.country });
    if (cur.ok) continue;
    console.log(`  ✗  ${slug}: current hero rejected (${cur.reason}) — replacing`);
  }

  const ctx = { name: data.place.name, category: data.category, region: data.region, country: data.country };
  const cands = await venuePhotoCandidates({ name: data.place.name, lat: data.place.lat, lng: data.place.lng });
  // FREE source too: Wikimedia via the strict resolver (≥2-token name+region
  // match, geograph banned). Famous landmarks (Sagrada Família, Wat Arun…)
  // recover from here without any FSQ credits; vision still has the final say.
  try {
    const wiki = await resolveHero({
      namedVenue: data.place.name, region: data.region,
      topic: (data.tags && data.tags[1]) || data.category,
      country: data.country, used, strict: true,
    });
    if (wiki?.url) cands.push(wiki);
  } catch {}
  let done = false;
  for (const cand of cands) {
    if (used.has(cand.url)) continue;
    const vis = await verifyHeroImage({ url: cand.url, ...ctx });
    if (!vis.ok) { console.log(`   ${slug}: rejected (${vis.reason})`); continue; }
    if (DRY) { console.log(`  · would fix ${slug} ← ${cand.url.slice(0, 70)}`); done = true; fixed++; break; }
    data.heroImage = { url: cand.url, credit: cand.credit, license: cand.license, source: cand.source };
    const wasDraft = data.draft === true;
    if (wasDraft) delete data.draft;
    await writeFile(path, `---\n${yaml.dump(data, { lineWidth: -1, noRefs: true, sortKeys: false })}---\n${content}`, 'utf8');
    used.add(cand.url);
    fixed++;
    if (wasDraft) { undrafted++; console.log(`  ✅ ${slug}: FIXED + republished (${vis.reason})`); }
    else console.log(`  ✅ ${slug}: FIXED (${vis.reason})`);
    done = true;
    break;
  }
  if (!done) {
    unfixed++;
    rewriteList.push(slug);
    // Accuracy rule: a KNOWN-wrong photo may not stay live — quarantine until a
    // real photo or a venue rewrite restores the post.
    if (!DRY && data.draft !== true) {
      data.draft = true;
      await writeFile(path, `---\n${yaml.dump(data, { lineWidth: -1, noRefs: true, sortKeys: false })}---\n${content}`, 'utf8');
      console.log(`  🚫 ${slug}: quarantined (draft) — no passing candidate (${cands.length} tried)`);
    } else {
      console.log(`  ⚠️  ${slug}: no candidate passed vision (${cands.length} tried)`);
    }
  }
}

console.log(`\n📦 scanned ${scanned} target(s): ${fixed} fixed · ${undrafted} republished · ${unfixed} need venue-rewrite`);
if (rewriteList.length) console.log('REWRITE_LIST ' + rewriteList.join(','));
console.log(`ALT_SUMMARY fixed=${fixed} undrafted=${undrafted} unfixed=${unfixed}`);
