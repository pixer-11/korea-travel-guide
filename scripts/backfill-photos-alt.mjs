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
// visual-audit.json is keyed by slug+heroUrl and never forgets: once a post is
// fixed, the OLD key keeps its MISMATCH verdict forever while a new key records
// the new photo as MATCH. Adding every MISMATCH slug therefore re-queued ~200
// already-fixed posts every night (the patrol's "scanned 399 targets"). Keep a
// slug only when the verdict belongs to the hero it is CURRENTLY showing.
const vmismatchUrls = new Map(); // slug → Set(url judged MISMATCH)
let auditStore = null;      // the parsed store, so an acquittal can be written back
let auditDirty = false;
const acquitted = [];
if (existsSync('data/visual-audit.json')) {
  try {
    const audit = JSON.parse(readFileSync('data/visual-audit.json', 'utf8'));
    const entries = audit.results ?? audit ?? {};
    if (!audit.results) auditStore = audit; // flat store → safe to edit in place
    for (const [key, item] of Object.entries(entries)) {
      if (!item?.slug) continue;
      if (!(item.verdict || item.status || '').toUpperCase().includes('MISMATCH')) continue;
      // key === `${slug}\x01${url}` (visual-audit.mjs joins them with \x01).
      // Tolerate a plain-concat key too, in case older entries lack the separator.
      const rest = key.startsWith(item.slug) ? key.slice(item.slug.length) : '';
      const url = rest.startsWith('\x01') ? rest.slice(1) : rest;
      if (!vmismatchUrls.has(item.slug)) vmismatchUrls.set(item.slug, new Set());
      vmismatchUrls.get(item.slug).add(url);
    }
  } catch {}
}
// The WEEKLY full-content audit's image failures feed the fix queue too — user
// caught live posts (Cure Bali rice terrace, Pak Gula sunset) that the old list
// missed because this wiring didn't exist.
if (existsSync('data/full-audit.json')) {
  try {
    const fa = JSON.parse(readFileSync('data/full-audit.json', 'utf8'));
    for (const r of fa.results ?? []) if (r.image && r.slug) vmismatch.add(r.slug);
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
  if (data.category === 'event') continue; // events keep their performer/type pipeline
  // Venue-LIKE posts without a Google place object (web-discovered trendy spots
  // e.g. Cure Bali / Pak Gula) were a blind spot — derive the venue name from
  // the title and search by name+city instead of coordinates.
  const VENUE_CATS = new Set(['restaurant', 'trendy', 'hidden-gem', 'attraction']);
  const titleName = String(data.title).split(/[:—]/)[0].replace(/\s+in\s+.+$/i, '').trim();
  const venueName = data.place?.name || (VENUE_CATS.has(data.category) ? titleName : null);
  if (!venueName) continue;

  // AUDIT_ALL=1 → EVERY venue post is vision-checked (catches name-collision
  // cases the filename heuristic can't see, e.g. Rolo's restaurant wearing a
  // Rolo-candy photo). Default mode only touches the known backlog.
  // Stale-verdict guard: only treat a MISMATCH as current if it was recorded
  // against the hero this post still shows (see vmismatchUrls above).
  const flaggedNow =
    vmismatch.has(slug) ||
    (vmismatchUrls.get(slug)?.has(data.heroImage?.url || '') ?? false);
  const isTarget =
    process.env.AUDIT_ALL === '1' ||
    ONLY.length > 0 ||
    data.draft === true ||
    flaggedNow ||
    (data.heroImage?.url || '').includes('placeholder');
  if (!isTarget) continue;
  scanned++;

  // Stock photography is banned on a NAMED venue by policy, not by judgement:
  // a generic Unsplash cafe shot looks like a perfectly plausible cafe, so the
  // vision gate approves it every time and the post keeps a photo that is not of
  // this place at all (2026-07-28: 20 venue posts sat like this and a targeted
  // patrol run 'fixed' none of them). Skip the keep-it shortcut for those.
  const STOCK_BANNED_CATS = new Set(['restaurant', 'cafe', 'trendy', 'hidden-gem', 'food']);
  const heroIsStock = data.heroImage?.license === 'unsplash' && STOCK_BANNED_CATS.has(data.category);
  if (heroIsStock) console.log(`  ✗  ${slug}: stock hero on a named venue — replacing regardless of vision`);

  // Current hero first: if the AI approves what's already there, keep it.
  if (!heroIsStock && data.heroImage?.url && data.draft !== true) {
    const cur = await verifyHeroImage({ url: data.heroImage.url, name: venueName, category: data.category, region: data.region, country: data.country });
    if (cur.ok) {
      // Record the acquittal. The weekly audit is a single vision call and does
      // get landmarks wrong (2026-07-27: it called Gyeonghoeru "a Gyeongju
      // pavilion" and the Wat Pho reclining Buddha "an upright statue" — both
      // verified correct by eye). Without writing the appeal back, the stale
      // MISMATCH kept re-queueing the post every night and re-alarming the owner.
      if (flaggedNow) { acquitted.push(slug); auditDirty = true; delete auditStore[`${slug}\x01${data.heroImage.url}`]; }
      continue;
    }
    console.log(`  ✗  ${slug}: current hero rejected (${cur.reason}) — replacing`);
  }

  const ctx = { name: venueName, category: data.category, region: data.region, country: data.country };
  const cands = await venuePhotoCandidates({
    name: venueName,
    lat: data.place?.lat, lng: data.place?.lng,
    near: `${data.region}, ${data.country ?? 'South Korea'}`,
  });
  // FREE source too: Wikimedia via the strict resolver (≥2-token name+region
  // match, geograph banned). Famous landmarks (Sagrada Família, Wat Arun…)
  // recover from here without any FSQ credits; vision still has the final say.
  try {
    const wiki = await resolveHero({
      namedVenue: venueName, region: data.region,
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

// Persist acquittals so a hero the patrol has cleared stops being re-queued.
if (!DRY && auditDirty && auditStore) {
  await writeFile('data/visual-audit.json', JSON.stringify(auditStore, null, 1) + '\n', 'utf8');
  console.log(`\n⚖️  ${acquitted.length} previously-flagged hero(es) re-approved on review: ${acquitted.slice(0, 10).join(', ')}`);
}

console.log(`\n📦 scanned ${scanned} target(s): ${fixed} fixed · ${undrafted} republished · ${unfixed} need venue-rewrite`);
if (rewriteList.length) console.log('REWRITE_LIST ' + rewriteList.join(','));
console.log(`ALT_SUMMARY fixed=${fixed} undrafted=${undrafted} unfixed=${unfixed}`);
