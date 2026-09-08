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
import matter from 'gray-matter';
import yaml from 'js-yaml';
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
const unreadable = [];

for (const f of readdirSync(DIR).filter((f) => f.endsWith('.md'))) {
  const raw = readFileSync(join(DIR, f), 'utf8');
  const slug = f.replace(/\.md$/, '');

  // Everything below reads the PARSED frontmatter. Patterns were wrong in three
  // separate ways here (found 2026-09-08 by Codex): `heldReason : cancelled` is
  // valid YAML that `/^heldReason:/` misses, so a cancelled event could have
  // been published; `heroImage :` and `heroImage: {url: …}` survived the strip,
  // so the quarantined photo would have gone live under a `photoless: true`
  // flag; and a `draft: true` line inside a body code sample was edited instead
  // of the real one. A parser sees what YAML sees.
  let fm;
  try { fm = matter(raw); } catch (err) {
    // A post this script cannot read is a post it did not consider. Swallowing
    // the error let `published=0 of=0` mean two different things: "nothing
    // qualified" and "I could not read the input".
    unreadable.push(`${slug}: ${err.message.split('\n')[0]}`);
    continue;
  }
  if (fm.data?.draft !== true) continue;

  // A stated hold is a decision someone made for a reason that is not the
  // photo — cancelled, duplicate, wrong region. Never overridden here.
  if (fm.data?.heldReason) continue;

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

  // gray-matter's body, not a slice from the first '\n---' it can find. A file
  // with no closing delimiter made that slice start at character 3, so 500 words
  // of frontmatter counted as an article and a post with no body at all
  // qualified.
  const words = fm.content.split(/\s+/).filter(Boolean).length;
  if (words < MIN_WORDS) { why.push(`${slug}: ${words} words — too thin to stand without a photo`); continue; }

  picked.push({ slug, file: join(DIR, f), fm, raw, clicks, imp, pos, tries, words });
}

picked.sort((a, b) => b.clicks - a.clicks || b.imp - a.imp);

console.log(`${picked.length} quarantined post(s) qualify to publish without a photo\n`);
for (const r of picked) {
  console.log(`  ${r.slug}`);
  console.log(`     ${r.clicks} click(s) · ${r.imp} impression(s) · position ${r.pos} · ${r.tries} photo attempts · ${r.words} words`);
}
for (const line of why) console.log(`  – skipped ${line}`);
for (const u of unreadable) console.log(`  ❗ could not read ${u}`);

if (!APPLY) {
  console.log('\n--apply to strip the quarantined hero and publish these.');
  process.exit(0);
}

let done = 0;
for (const r of picked) {
  // The hero has to go: every one of these is still carrying the stock or
  // wrong-venue photo it was quarantined FOR, and publishing without removing it
  // would put exactly that picture back in front of readers.
  //
  // NOTHING is re-serialised. An earlier version rebuilt the file with
  // matter.stringify, and that turned out to do two destructive things:
  //
  //  · it re-parses the body it is handed, so a body that BEGINS with `---`
  //    (a Markdown horizontal rule) is read as another frontmatter block and
  //    swallowed. Reproduced: 414 words became 2, and the checks below all
  //    passed because they only looked at three flags.
  //  · it drops quotes that carry meaning. `description: "09"` came back as
  //    `description: 09`. gray-matter's js-yaml 3 still reads that as a string,
  //    so a verification pass sees nothing wrong — but Astro's js-yaml 4 reads
  //    it as the number 9, which violates `description: z.string()` and stops
  //    the build.
  //
  // So the body is never touched, and the frontmatter keeps every line it
  // already had. Only the three lines that must change are edited.
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(r.raw);
  if (!fmMatch) { console.log(`  ⚠️ ${r.slug}: no frontmatter block — left alone`); continue; }
  const body = r.raw.slice(fmMatch[0].length);

  // Drop the heroImage key and the lines indented under it.
  const kept = [];
  let under = null;
  for (const line of fmMatch[1].split('\n')) {
    const indent = /^(\s*)/.exec(line)[1].length;
    if (/^heroImage\s*:/.test(line)) { under = indent; continue; }
    if (under !== null) {
      if (line.trim() === '' || indent > under) continue;
      under = null;
    }
    kept.push(line);
  }

  let fmText = kept
    .map((l) => (/^draft\s*:/.test(l) ? 'draft: false' : l))
    .filter((l) => !/^photoless\s*:/.test(l))
    .join('\n');
  fmText += '\nphotoless: true';

  const out = `---\n${fmText}\n---\n${body}`;

  // Verify against the ORIGINAL, not against three flags. The body must come
  // back byte for byte, and every field except the three we meant to change
  // must be unchanged — that is what makes "the rewrite is safe" a fact rather
  // than a hope.
  let check;
  try { check = matter(out); } catch (err) {
    console.log(`  ⚠️ ${r.slug}: the rewrite would not parse (${err.message.split('\n')[0]}) — left alone`);
    continue;
  }
  if (check.content !== r.fm.content) {
    console.log(`  ⚠️ ${r.slug}: the body changed — left alone`);
    continue;
  }
  if (check.data.heroImage || check.data.draft !== false || check.data.photoless !== true) {
    console.log(`  ⚠️ ${r.slug}: the rewrite did not take — left alone`);
    continue;
  }
  const untouched = (o) => Object.fromEntries(Object.entries(o)
    .filter(([k]) => !['heroImage', 'draft', 'photoless'].includes(k)));
  if (JSON.stringify(untouched(check.data)) !== JSON.stringify(untouched(r.fm.data))) {
    console.log(`  ⚠️ ${r.slug}: a frontmatter field other than the three changed — left alone`);
    continue;
  }
  writeFileSync(r.file, out, 'utf8');
  console.log(`  ✅ ${r.slug} — hero removed, published`);
  done++;
}
console.log(`\nPHOTOLESS_RELEASE published=${done} of=${picked.length} unreadable=${unreadable.length}`);
// Input this script could not read is not a clean run, whatever the other counts say.
if (unreadable.length) process.exit(1);
