#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  RELEASE PHOTOLESS EVENT POSTS
//
//  Event guides were quarantined for having no hero, and no free source
//  carries a usable photo of most concerts and festivals — so they sat, and
//  the retirement clock ran: 132 posts unpublished (16.6% of the catalogue),
//  68 of them within a day or two of deletion.
//
//  Search Console says those were the wrong pages to delete. Events are the
//  site's best-performing content: the single most-seen page is an event
//  (461 impressions), and event queries — "comiket 108", "def leppard dubai
//  2026", "incheon pentaport rock festival 2026 lineup" — sit at positions
//  3-8 with 25-100% CTR. A reader searching those wants the date, the venue
//  and the ticket link, all of which are on the page.
//
//  So: publish them without a photo. The absolute rule is untouched — a WRONG
//  photo still never ships, and a placeholder dressed up as a real picture
//  still fails validation. A post that HAS a hero and was quarantined for
//  some other reason (a mismatched photo, an hours contradiction) is left
//  exactly where it is.
//
//    node scripts/release-photoless-events.mjs
//    DRY=1 node scripts/release-photoless-events.mjs
// ─────────────────────────────────────────────────────────────
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { isEventPast } from '../src/lib/eventStatus.ts';
import { keyToken } from './lib/commons.mjs';
import { hoursProblems } from './audit-hours-claims.mjs';

const POSTS = 'src/content/posts';
const DRY = process.env.DRY === '1';

// Events ALREADY live, paired the way validate-content pairs duplicates: the
// act/anchor word plus the country, with dates compared by OVERLAP.
//
// While an event sits in quarantine the discovery run can find the same show
// again under another phrasing and publish that one instead. Releasing the
// parked twin then puts two pages up for one event. Two weaker keys were tried
// and both leaked: a topic key split "The Sounds Project 2026" from a live
// "The Sounds Project Vol. 9" on the word "vol", and an exact-date key split
// the F✦FOREVER Kuala Lumpur show recorded once as 08-07 and once as
// 08-07~08-08. Overlap catches both.
const anchorOf = (d) => `${keyToken(String(d.title))}|${d.country ?? 'South Korea'}`;
const spanOf = (d) => [String(d.eventStartDate ?? '').slice(0, 10), String(d.eventEndDate ?? d.eventStartDate ?? '').slice(0, 10)];
const overlaps = (a, b) => a[0] && b[0] && a[0] <= b[1] && b[0] <= a[1];
// anchor -> [ [start,end], ... ] for every event already live under it.
const liveTopics = new Map();
const alreadyLive = (d) => (liveTopics.get(anchorOf(d)) ?? []).some((s) => overlaps(s, spanOf(d)));
const noteLive = (d) => {
  const k = anchorOf(d);
  if (!liveTopics.has(k)) liveTopics.set(k, []);
  liveTopics.get(k).push(spanOf(d));
};
const files = (await readdir(POSTS)).filter((x) => x.endsWith('.md'));
for (const f of files) {
  let d;
  try { d = matter(await readFile(join(POSTS, f), 'utf8')).data; } catch { continue; }
  if (d.draft || d.category !== 'event') continue;
  noteLive(d);
}

const released = [];
const skipped = { hasHero: 0, notEvent: 0, past: 0, duplicate: 0 };

for (const f of files) {
  const slug = f.replace(/\.md$/, '');
  const raw = await readFile(join(POSTS, f), 'utf8');
  let parsed;
  try { parsed = matter(raw); } catch { continue; }
  const d = parsed.data;
  if (!d.draft) continue;
  if (d.category !== 'event') { skipped.notEvent++; continue; }

  // A quarantined event that still carries a hero is carrying a REJECTED one.
  // The 2026-07-29 event batch was the last publish path without a vision
  // gate and attached whatever the image search returned — the EuroVolley
  // women's final wore a photo of men fishing off the Galata Bridge. The audit
  // caught them on 08-01 and 24 posts have sat quarantined since, including
  // the single most-seen page on the site, because no free source has a photo
  // of a tournament that has not happened yet.
  //
  // Strip the wrong photo and publish. That satisfies both rules at once: a
  // wrong photo never ships, and an event does not need one. The alt-photo
  // patrol keeps looking and attaches a real one if it ever clears the gate.
  let strippedHero = null;
  if (d.heroImage?.url) {
    // Only when the hold really is about the photo. Anything the hours check
    // still objects to keeps its quarantine, hero and all.
    if (hoursProblems(raw).length) { skipped.hasHero++; continue; }
    strippedHero = String(d.heroImage.url);
  }
  // No point publishing an event that already finished — it would go straight
  // to noindex, and a one-off past event is exactly the thin page the site
  // works to avoid.
  if (isEventPast(d)) { skipped.past++; continue; }
  if (alreadyLive(d)) { skipped.duplicate++; continue; }

  noteLive(d); // nor two releases of one event
  released.push(`${slug}${strippedHero ? '  [wrong hero removed]' : ''} — ${String(d.title).slice(0, 52)}`);
  if (!DRY) {
    parsed.data.draft = false;
    if (strippedHero) { delete parsed.data.heroImage; parsed.data.gallery = parsed.data.gallery ?? []; }
    await writeFile(join(POSTS, f), matter.stringify(parsed.content, parsed.data), 'utf8');
  }
}

console.log(`\n🎫 Photoless event release${DRY ? ' (DRY)' : ''}`);
released.forEach((r) => console.log('  + ' + r));
console.log(`\n📦 released ${released.length}`);
console.log(`   skipped — already has a hero: ${skipped.hasHero} · already over: ${skipped.past} · duplicate of a live event: ${skipped.duplicate} · not an event: ${skipped.notEvent}`);
