#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  A GUIDE THAT RANKS, HIDDEN BEHIND A REDIRECT
//
//  Venue posts may not publish without a photo. That rule is right almost
//  always: a restaurant guide with no picture is a thinner page, and photos are
//  this site's first quality axis.
//
//  It is wrong for one small set. Measured 2026-09-08: 24 quarantined posts
//  drew 83 impressions and 4 clicks in 28 days, and every one of those clicks
//  landed on a 302 to the city hub — someone searched for a specific restaurant
//  in Yeosu, we ranked 4.3 for it, and we sent them to a list of Yeosu. That is
//  not "no photo yet", it is a broken answer, and Google eventually stops
//  offering a URL that redirects.
//
//  The photo will not arrive. These were searched 19 to 42 nights each across
//  Foursquare, Commons and Openverse. A small restaurant in Yeosu has no
//  free-licensed photograph and no amount of patience creates one. (Google
//  Places photos are unavailable to this account — Vietnam is outside its
//  billing region.)
//
//  So: strip the hero — every one of them is still carrying the stock or
//  wrong-venue image it was quarantined FOR — and publish the article. The body
//  is 640-800 words of real, editor-reviewed guidance, and it answers the
//  question the searcher asked. Events already publish this way and the page
//  renders complete without a picture.
//
//  It stays in the photo hunt: lib/patrol-target.mjs counts a live post with no
//  hero as a target, so the first honest photograph that appears still lands.
//
//  The bar is deliberately narrow — this is an exception, not a new default.
//  The other ~130 quarantined posts draw nothing, so keeping them down costs
//  nothing and this leaves them alone.
//
//    node scripts/release-photoless-earners.mjs        # show what qualifies
//    node scripts/release-photoless-earners.mjs --apply
// ─────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GIVE_UP_AFTER } from './lib/photo-queue-order.mjs';

const DIR = 'src/content/posts';
const APPLY = process.argv.includes('--apply');

// Every condition has to hold. Each one is here because dropping it would let
// something through that should stay down.
const MIN_IMPRESSIONS = 5;    // fewer is noise, not demand
const MAX_POSITION = 20;      // ranking on page 1-2; position 71 earns nothing
const MIN_WORDS = 400;        // a real guide, not a stub

const perf = existsSync('data/gsc-page-performance.json')
  ? JSON.parse(readFileSync('data/gsc-page-performance.json', 'utf8')).pages || {}
  : {};
const retry = existsSync('data/photo-retry.json')
  ? JSON.parse(readFileSync('data/photo-retry.json', 'utf8')) : {};

const picked = [];
const why = [];

for (const f of readdirSync(DIR).filter((f) => f.endsWith('.md'))) {
  const raw = readFileSync(join(DIR, f), 'utf8');
  if (!/^draft:\s*true\s*$/m.test(raw)) continue;
  const slug = f.replace(/\.md$/, '');

  // A stated hold is a decision someone made for a reason that is not the
  // photo — cancelled, duplicate, wrong region. Never overridden here.
  if (/^heldReason:\s*\S/m.test(raw)) continue;

  const p = perf[slug];
  if (!p) continue;
  const clicks = p.clicks || 0;
  const imp = p.impressions || 0;
  const pos = p.position;
  if (clicks < 1 && imp < MIN_IMPRESSIONS) continue;
  if (pos == null || pos > MAX_POSITION) { why.push(`${slug}: ranks ${pos ?? '?'} — too far down to be earning`); continue; }

  // Only where the hunt is genuinely over. A post still inside its first seven
  // nights might get a real photo tomorrow; wait for it.
  const tries = retry[slug] ?? 0;
  if (tries < GIVE_UP_AFTER) { why.push(`${slug}: only ${tries} photo attempts — the hunt is still live`); continue; }

  const body = raw.slice(raw.indexOf('\n---', 3) + 4);
  const words = body.split(/\s+/).filter(Boolean).length;
  if (words < MIN_WORDS) { why.push(`${slug}: ${words} words — too thin to stand without a photo`); continue; }

  picked.push({ slug, file: join(DIR, f), raw, clicks, imp, pos, tries, words });
}

picked.sort((a, b) => b.clicks - a.clicks || b.imp - a.imp);

console.log(`${picked.length} quarantined post(s) qualify to publish without a photo\n`);
for (const r of picked) {
  console.log(`  ${r.slug}`);
  console.log(`     ${r.clicks} click(s) · ${r.imp} impression(s) · position ${r.pos} · ${r.tries} photo attempts · ${r.words} words`);
}
for (const line of why) console.log(`  – skipped ${line}`);

if (!APPLY) {
  console.log('\n--apply to strip the quarantined hero and publish these.');
  process.exit(0);
}

let done = 0;
for (const r of picked) {
  // The hero has to go. Every one of these is still carrying the stock or
  // wrong-venue photo it was quarantined for; publishing without stripping it
  // would put exactly that picture back in front of readers.
  let out = r.raw.replace(/^heroImage:(?:\r?\n(?:[ \t]+.*)?)*\r?\n?/m, '');
  if (/^heroImage:/m.test(out)) { console.log(`  ⚠️ ${r.slug}: could not strip the hero — left alone`); continue; }
  out = out.replace(/^draft:\s*true\s*$/m, 'draft: false');
  if (/^draft:\s*true\s*$/m.test(out)) { console.log(`  ⚠️ ${r.slug}: could not clear the draft flag — left alone`); continue; }
  // `photoless: true` is the repo's existing, documented way to say "a venue
  // guide that ships without a picture, deliberately" — validate-content reads
  // it, and it was written for exactly this situation after the 2026-07-26
  // deletions. Without it the content gate reports these nine as missing
  // images every night, which is a true statement made into noise.
  if (!/^photoless:\s*true\s*$/m.test(out)) {
    out = out.replace(/^draft:\s*false\s*$/m, 'draft: false\nphotoless: true');
  }
  writeFileSync(r.file, out, 'utf8');
  console.log(`  ✅ ${r.slug} — hero removed, published`);
  done++;
}
console.log(`\nPHOTOLESS_RELEASE published=${done} of=${picked.length}`);
