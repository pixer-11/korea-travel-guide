#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  RELEASE VERIFIED QUARANTINE — publish a held post whose photo is fine.
//
//  Why this exists as its own tool. A post goes into photo quarantine
//  (draft:true) when its hero is wrong or missing. The only route back out was
//  inside backfill-photos-alt: "found a NEW photo and it passed". A post whose
//  hero was fixed some other way — a later Commons sweep, an alt-source pass, a
//  hand edit — could never take that route, because the search runs again,
//  finds nothing better than the good photo already there, and gives up. On
//  2026-08-11 that had stranded 40 complete guides, 11 of them already carrying
//  a MATCH verdict on file.
//
//  Adding the release to that patrol was tried first and reverted: the run
//  reported 2 republished while 35 posts actually lost their draft flag, and a
//  publish nobody can explain is worse than a post nobody can see. So the
//  release lives here instead, where it is the ONLY thing that happens:
//
//    - one post at a time, no other mutation in the file;
//    - every decision printed with its reason, and the counters are derived
//      from the writes themselves, so the log cannot disagree with the disk;
//    - --dry prints the same decisions and writes nothing.
//
//  Two independent gates must both pass, matching the patrol's own rule:
//    1. vision approves the CURRENT hero (existing:true — the bar for a photo
//       already on the page, not for choosing a new one);
//    2. hoursProblems() is clean — a photo fix lifts only the photo hold, and
//       republishing a post whose prose contradicts its own opening hours is
//       the mistake of 2026-07-31.
//  heldReason posts are skipped outright: those are hours/content quarantines
//  where the photo was never the question.
//
//    node scripts/release-verified-quarantine.mjs --dry     # decide, write nothing
//    node scripts/release-verified-quarantine.mjs           # apply
//    SLUGS=a,b node scripts/release-verified-quarantine.mjs # only these
//    LIMIT=10 node scripts/release-verified-quarantine.mjs  # stop after N releases
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { verifyHeroImage } from './lib/vision-check.mjs';
import { hoursProblems } from './audit-hours-claims.mjs';
import { wrongVenueCredit } from './lib/photo-credit-identity.mjs';

const POSTS = 'src/content/posts';
const DRY = process.argv.includes('--dry') || process.env.DRY === '1';
const LIMIT = Number(process.env.LIMIT ?? 1000);
const ONLY = (process.env.SLUGS || '').split(',').map((s) => s.trim()).filter(Boolean);
const AUDIT = 'data/visual-audit.json';

if (!process.env.ANTHROPIC_API_KEY) {
  console.log('ANTHROPIC_API_KEY missing — refusing to release anything unverified.');
  process.exit(1);
}

const audit = existsSync(AUDIT) ? JSON.parse(readFileSync(AUDIT, 'utf8')) : {};
let auditDirty = false;

const released = [];   // slugs actually written
const kept = [];       // {slug, why}
let checked = 0;

for (const f of readdirSync(POSTS).filter((x) => x.endsWith('.md'))) {
  if (released.length >= LIMIT) break;
  const slug = f.replace(/\.md$/, '');
  if (ONLY.length && !ONLY.includes(slug)) continue;

  const path = `${POSTS}/${f}`;
  const raw = readFileSync(path, 'utf8');
  const { data, content } = matter(raw);

  if (data.draft !== true) continue;                       // already live
  if (data.heldReason) { kept.push({ slug, why: `heldReason:${data.heldReason} — not a photo hold` }); continue; }
  const url = data.heroImage?.url;
  if (!url || String(url).includes('placeholder')) { kept.push({ slug, why: 'no hero to verify' }); continue; }

  // STOCK PHOTOGRAPHY IS NOT EVIDENCE, and vision cannot see the difference:
  // a generic Unsplash cafe interior looks exactly like a plausible photo of
  // THIS cafe, so the gate approves it every time (backfill-photos-alt carries
  // the same guard for the same reason). The first run of this tool did not,
  // and released 8 posts wearing stock heroes — Jalinan got a Kuala Lumpur
  // skyline, the Pohang K-drama site got an anonymous pavilion. A named place
  // must show ITSELF; releasing a stock photo publishes a picture of nowhere.
  // Events are exempt: their hero is the act or the sport by design.
  const STOCK_CATS = new Set(['restaurant', 'cafe', 'trendy', 'hidden-gem', 'food', 'attraction']);
  const isStock = data.heroImage?.license === 'unsplash' || /images\.unsplash\.com/.test(String(url));
  if (isStock && data.category !== 'event' && (data.place?.name || STOCK_CATS.has(data.category))) {
    kept.push({ slug, why: 'stock hero on a named place — needs a real photo, not a release' });
    continue;
  }

  // The credit line names the business the photo belongs to, and vision cannot
  // read it: a genuine photo of a genuine café is a plausible café whatever the
  // sign says. The first release run put five of these live — Ajman Secret
  // Beach credited "Al Zaurah Beach", Sansan Bistro credited "Sugar Bistro" —
  // every one approved by vision and caught by the validator afterwards. Check
  // it here, where it can still stop the publish.
  const wrongVenue = wrongVenueCredit(data.place?.name, data.heroImage?.credit);
  if (wrongVenue) {
    kept.push({ slug, why: `photo credits a different business: "${wrongVenue}"` });
    continue;
  }

  checked++;
  const venueName = data.place?.name || String(data.title).split(/[:—]/)[0].trim();
  const v = await verifyHeroImage({
    url, name: venueName, category: data.category, region: data.region,
    country: data.country, eventMode: data.category === 'event', existing: true,
  });

  // An unreachable vision API is NOT an approval (the gate fails closed), and
  // it is not a rejection worth recording either — leave the post exactly as
  // it is and try again another day.
  if (/vision unavailable|no-api-key|vision check failed/i.test(v.reason || '')) {
    kept.push({ slug, why: `vision unavailable — untouched (${v.reason})` });
    continue;
  }
  if (!v.ok) {
    kept.push({ slug, why: `hero rejected: ${String(v.reason || '').slice(0, 90)}` });
    // Record the rejection so the photo patrol knows to look for a replacement.
    audit[`${slug}\x01${url}`] = { slug, verdict: 'MISMATCH', reason: `release check: ${String(v.reason || '').slice(0, 150)}`, at: new Date().toISOString() };
    auditDirty = true;
    continue;
  }

  // Gate 2: the other hold. Build the would-be file and re-run the hours check.
  const next = { ...data };
  delete next.draft;
  const out = `---\n${yaml.dump(next, { lineWidth: -1, noRefs: true, sortKeys: false })}---\n${content}`;
  const holds = hoursProblems(out);
  if (holds.length) {
    kept.push({ slug, why: `photo OK but hours hold remains: ${holds[0]}` });
    continue;
  }

  if (!DRY) writeFileSync(path, out, 'utf8');
  audit[`${slug}\x01${url}`] = { slug, verdict: 'MATCH', reason: `release check: ${String(v.reason || 'approved').slice(0, 150)}`, at: new Date().toISOString() };
  auditDirty = true;
  released.push(slug);
  console.log(`  ✅ ${slug} — RELEASED (${v.reason})`);
}

for (const k of kept) console.log(`  ⏸️  ${k.slug} — kept: ${k.why}`);

if (auditDirty && !DRY) writeFileSync(AUDIT, JSON.stringify(audit, null, 2) + '\n', 'utf8');

// Counted from the writes, not from a separate tally — the released list IS the
// set of files touched, so this line cannot drift from what is on disk.
console.log(`\n📦 checked ${checked} quarantined post(s) with a hero · released ${released.length} · kept ${kept.length}`);
console.log(`RELEASE_SUMMARY released=${released.length} kept=${kept.length} checked=${checked}${DRY ? ' (dry run — nothing written)' : ''}`);
if (released.length) console.log('RELEASED_LIST ' + released.join(','));
