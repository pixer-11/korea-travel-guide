#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  UN-PARK — republish an itinerary whose reason for being parked is gone.
//
//  build-itineraries.mjs parks an itinerary when one of its stops gets
//  quarantined, which is right: a day plan that sends a reader to a page that
//  no longer exists is worse than no day plan. What it lacks is the way back.
//  Un-parking only happens as a side effect of a SUCCESSFUL regeneration, so an
//  itinerary whose stops have all returned stays down for as long as
//  regeneration keeps failing for some unrelated reason.
//
//  That is not hypothetical. Bangkok — the best-covered city on the site, 17
//  qualifying venues against a gate of 12 — was parked on 2026-08-04 by the
//  photo identity sweep. Every one of its ten stops was republished afterwards,
//  and the file itself passes the validator today. But every nightly run since
//  tried to REGENERATE it (the stop pool had changed by 8 slugs), the new prose
//  failed validation on a stop-count claim, the builder correctly left the
//  existing file untouched — and "untouched" meant "still parked". The city's
//  finished itinerary sat behind a 301 for three days.
//
//  So this checks the one question that actually decides it: are all of this
//  itinerary's stops live again? If yes, publish it. Regeneration can keep
//  trying to improve it on its own schedule.
//
//  Usage:
//    node scripts/unpark-itineraries.mjs            # apply
//    node scripts/unpark-itineraries.mjs --dry-run  # report only
// ─────────────────────────────────────────────────────────────
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

const ITIN = 'src/content/itineraries';
const POSTS = 'src/content/posts';
const DRY = process.argv.includes('--dry-run');

const isDraftPost = async (slug) => {
  const p = join(POSTS, `${slug}.md`);
  if (!existsSync(p)) return true; // gone entirely — still a dead link
  try { return matter(await readFile(p, 'utf8')).data.draft === true; } catch { return true; }
};

const files = (await readdir(ITIN)).filter((f) => f.endsWith('.md'));
const freed = [];
const held = [];

for (const f of files) {
  const raw = await readFile(join(ITIN, f), 'utf8');
  let parsed;
  try { parsed = matter(raw); } catch { continue; }
  const d = parsed.data;
  if (d.draft !== true && d.parked !== true) continue;

  // Every slug the page would link to, including the rain-day swaps.
  const slugs = [
    ...(d.itinerary ?? []).flatMap((day) => (day.stops ?? []).map((s) => s.slug)),
    ...(d.itinerary ?? []).map((day) => day.rainSwapSlug),
  ].filter(Boolean);

  const broken = [];
  for (const s of new Set(slugs)) if (await isDraftPost(s)) broken.push(s);

  if (broken.length) {
    held.push(`${f} — ${broken.length} stop(s) still down: ${broken.slice(0, 4).join(', ')}`);
    continue;
  }

  freed.push(`${f} — ${new Set(slugs).size} stop(s) all live`);
  if (!DRY) {
    parsed.data.draft = false;
    parsed.data.parked = false;
    await writeFile(join(ITIN, f), matter.stringify(parsed.content, parsed.data), 'utf8');
  }
}

console.log(`\n🗺️  Un-park${DRY ? ' (dry run)' : ''}: ${freed.length} republished · ${held.length} still held`);
freed.forEach((x) => console.log(`  ✅ ${x}`));
held.forEach((x) => console.log(`  ⏸️  ${x}`));
// Loud on stdout for the workflow to pick up, quiet exit either way — an
// itinerary that stays parked is a normal outcome, not a failure.
console.log(`UNPARK_SUMMARY freed=${freed.length} held=${held.length}`);
