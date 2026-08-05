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
//  or SLUGS env (comma-separated) for a manual priority run. draft:true EVENT
//  posts are targets too, but repaired via the event-mode Commons search
//  (performer/sport photos), not the venue sources below.
//  Env: FOURSQUARE_API_KEY / FLICKR_API_KEY (either or both; skips cleanly if
//  neither), ANTHROPIC_API_KEY (vision), LIMIT (default 300), DRY=1.
//  Usage: node scripts/backfill-photos-alt.mjs
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { loadUsedImageUrls, resolveHero, eventTopic } from './lib/images.mjs';
import { keyToken, tokens } from './lib/commons.mjs';
import { venuePhotoCandidates } from './lib/photo-sources.mjs';
import { verifyHeroImage, auditHeroImage } from './lib/vision-check.mjs';
import { hoursProblems } from './audit-hours-claims.mjs';

const POSTS = 'src/content/posts';
const DRY = process.env.DRY === '1';
const LIMIT = Number(process.env.LIMIT ?? 300);
const ONLY = (process.env.SLUGS || '').split(',').map((s) => s.trim()).filter(Boolean);

// Without venue-photo keys this used to exit outright — but event drafts are
// repaired from Wikimedia Commons (no key) + vision, so a keyless run still
// has work to do. Venue posts keep the OLD behavior (skipped entirely): if
// they were scanned with no sources, every one would log an empty night and
// the retirement clock would advance on what is really a config problem.
const HAVE_VENUE_SOURCES = Boolean(process.env.FOURSQUARE_API_KEY || process.env.FLICKR_API_KEY);
if (!HAVE_VENUE_SOURCES) {
  console.log('No FOURSQUARE_API_KEY / FLICKR_API_KEY set — venue posts skipped; event drafts still repaired via Commons.');
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
// Consecutive nightly failures per slug. Seven strikes retires the post: these
// are small venues (a café in Yana, a noodle stall) that no free photo source
// has ever covered — after a week of the same empty answer, retrying is only a
// vision-API bill. Owner-approved 2026-07-31, with the volume rule attached:
// retirement never touches a LIVE page (only quarantined drafts qualify), so
// the published count is unchanged and the country-fill keeps adding new
// venues that DO have photos.
const RETRY_FILE = 'data/photo-retry.json';
const RETIRE_AFTER = 7;
const retryCount = existsSync(RETRY_FILE) ? JSON.parse(readFileSync(RETRY_FILE, 'utf8')) : {};

for (const f of files) {
  if (fixed + unfixed >= LIMIT) break;
  const slug = f.replace(/\.md$/, '');
  if (ONLY.length && !ONLY.includes(slug)) continue;
  const path = `${POSTS}/${f}`;
  const { data, content } = matter(await readFile(path, 'utf8'));
  // Events used to be skipped outright here ("events keep their performer/type
  // pipeline") — but that pipeline only exists at GENERATION time, so a
  // quarantined event post had NO refill path at all: the venue sources can't
  // photograph an act, and the retirement clock was the only thing still
  // ticking (the 07-29 pre-gate batch, 24 drafts). Event DRAFTS now ride this
  // patrol with the generator's own event-mode Commons search. Live event
  // posts stay off the books (even under AUDIT_ALL) unless SLUGS names them:
  // the retroactive sweep already re-audited them at the existing:true bar,
  // and nightly re-judging 50+ performer photos is vision bill, not safety.
  const isEvent = data.category === 'event';
  if (isEvent && data.draft !== true && !ONLY.includes(slug)) continue;
  if (!isEvent && !HAVE_VENUE_SOURCES) continue;
  // Venue-LIKE posts without a Google place object (web-discovered trendy spots
  // e.g. Cure Bali / Pak Gula) were a blind spot — derive the venue name from
  // the title and search by name+city instead of coordinates.
  const VENUE_CATS = new Set(['restaurant', 'trendy', 'hidden-gem', 'attraction']);
  const titleName = String(data.title).split(/[:—]/)[0].replace(/\s+in\s+.+$/i, '').trim();
  const venueName = data.place?.name || (isEvent || VENUE_CATS.has(data.category) ? titleName : null);
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
  // The test is "does this post name a specific place", not "is it a restaurant":
  // a category-only list missed two named ATTRACTIONS still wearing stock photos
  // (Gion Matsuri gallery, House of Tan Teng Niah). Topic posts with no named
  // place ("Sightseeing in Busan") legitimately use a city photo, and EVENTS use
  // a topical shot of the act or sport by design, so both stay exempt.
  const namesAPlace = Boolean(data.place?.name) || STOCK_BANNED_CATS.has(data.category);
  const heroIsStock =
    data.heroImage?.license === 'unsplash' && data.category !== 'event' && namesAPlace;
  if (heroIsStock) console.log(`  ✗  ${slug}: stock hero on a named venue — replacing regardless of vision`);

  // Current hero first: if the AI approves what's already there, keep it.
  if (!heroIsStock && data.heroImage?.url && data.draft !== true) {
    const cur = await verifyHeroImage({ url: data.heroImage.url, name: venueName, category: data.category, region: data.region, country: data.country, eventMode: isEvent, existing: true });
    // "Could not check" is NOT "rejected". Vision fails CLOSED (an API outage
    // returns ok:false), which is right when choosing a NEW photo and
    // catastrophic here: with AUDIT_ALL every live venue post gets its hero
    // re-judged nightly, so one Anthropic outage at 04:35 would have rejected
    // every current hero, found no passing replacement (same outage), and
    // quarantined up to LIMIT live posts in a single unmanned commit. An
    // unverifiable night must leave the post exactly as it is.
    if (/vision unavailable|no-api-key|vision check failed/i.test(cur.reason || '')) {
      console.log(`  ⏸️  ${slug}: vision unavailable — leaving post untouched`);
      continue;
    }
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

  const ctx = { name: venueName, category: data.category, region: data.region, country: data.country, eventMode: isEvent };
  let cands = [];
  if (isEvent) {
    // An event's correct hero is the ACT or the SPORT, not a building —
    // Foursquare/Flickr venue search has nothing to offer here (S874: event
    // posts fail venue-photo retrieval where venue posts succeed). Use the
    // generator's event-mode resolver instead: keyToken anchor on the act's
    // name, portrait allowed, event-type Commons fallback. One call returns
    // one pick, and it marks that pick in whatever `used` set it was handed —
    // so calling it against a throwaway copy surfaces the NEXT candidate each
    // round instead of re-fetching the one vision just rejected (the same
    // trap the wiki-rescue below once fell into, inverted into a feature).
    // No Unsplash: a stock "concert crowd" is some OTHER act — the exact
    // mismatch class this repair exists to clear — and eventMode vision
    // cannot tell acts apart, so the ban has to live here, before the gate.
    // Identity cross-audit ON THE FILENAME, because vision cannot tell acts
    // apart (the known blind spot): the very first live run handed the
    // Singapore Post Malone post "F1_Rocks_Singapore.jpg" — a real photo of a
    // DIFFERENT 2009 concert — and vision approved it as "generic concert".
    // A file that names the act (anchor token) is identity-confirmed. A file
    // that doesn't must be explainable ENTIRELY by the event's own words
    // (type / city / country / dates): one leftover proper noun means it is
    // some other act's photo, however on-topic it looks.
    const anchor = keyToken(venueName);
    const knownTok = new Set([
      ...tokens(venueName), ...tokens(eventTopic(venueName)),
      ...tokens(data.region || ''), ...tokens(data.country || ''),
    ]);
    const GENERIC_FILE_WORDS = new Set(['cropped', 'crop', 'photo', 'image', 'img', 'file', 'dsc', 'edit', 'edited', 'retouched', 'wikimedia', 'commons', 'flickr']);
    const foreignInFilename = (url) => {
      let file = String(url).split('/').pop() || '';
      try { file = decodeURIComponent(file); } catch {}
      const ft = tokens(file.replace(/\.(jpe?g|png)\b.*$/i, ''));
      if (anchor && ft.includes(anchor)) return '';
      return ft
        .filter((t) => !knownTok.has(t) && !GENERIC_FILE_WORDS.has(t))
        .filter((t) => !/^\d+(px)?$/.test(t))
        .join(' ');
    };
    const seen = new Set(used);
    for (let i = 0; i < 6; i++) {
      let pick = null;
      try {
        pick = await resolveHero({
          namedVenue: venueName, region: data.region, topic: eventTopic(venueName),
          country: data.country, used: seen, preferTopic: true, eventMode: true,
          allowUnsplash: false,
        });
      } catch {}
      if (!pick?.url || pick.license !== 'wikimedia') break; // placeholder → no candidates left
      const foreign = foreignInFilename(pick.url);
      // resolveHero already marked the reject in `seen`, so the next round
      // surfaces a different file rather than this one again.
      if (foreign) { console.log(`   ${slug}: candidate skipped — filename names another act (${foreign})`); continue; }
      cands.push(pick);
    }
  } else {
    cands = await venuePhotoCandidates({
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
      // resolveHero marks its pick in `used` before returning, and the candidate
      // loop below skips anything already in `used` — so this rescue was skipped
      // 100% of the time and famous landmarks were quarantined instead of fixed.
      // Un-mark our own reservation; resolveHero already proved no OTHER post has it.
      if (wiki?.url) { used.delete(wiki.url); cands.push(wiki); }
    } catch {}
  }
  let done = false;
  let visionOutage = false; // an unverifiable candidate is not an EMPTY night
  for (const cand of cands) {
    if (used.has(cand.url)) continue;
    // A candidate identical to the hero that got this post quarantined is not a
    // replacement. On 2026-08-05 the pool handed back the current hero for five
    // quarantined posts, verifyHeroImage approved what the audit had rejected,
    // and all five were republished with the SAME wrong photo under the banner
    // "교체 완료 · 전부 시각 검증 통과". Nothing had changed but the draft flag.
    if (cand.url === data.heroImage?.url) {
      console.log(`   ${slug}: candidate is the current hero — not a replacement`);
      continue;
    }
    // Nor is a photo this post has ALREADY been quarantined for. Excluding only
    // the CURRENT hero leaves the patrol free to pick the previous reject, and
    // the candidate pool is stable enough that it does: on 2026-08-06 both
    // bali-livingstone and chiang-mai-the-baristro came back carrying a photo the
    // audit had marked MISMATCH the day before — a genuine swap, straight back
    // into the same quarantine. The verdict store already knows; ask it.
    const priorVerdict = auditStore[`${slug}\x01${cand.url}`];
    if (priorVerdict && /MISMATCH/.test(String(priorVerdict.verdict))) {
      console.log(`   ${slug}: candidate was judged wrong before (${priorVerdict.reasonKo || priorVerdict.reason}) — skipping`);
      continue;
    }
    const vis = await verifyHeroImage({ url: cand.url, ...ctx });
    if (/vision unavailable|no-api-key|vision check failed/i.test(vis.reason || '')) visionOutage = true;
    if (!vis.ok) { console.log(`   ${slug}: rejected (${vis.reason})`); continue; }
    // Clear the bar that QUARANTINED the post, not merely the selection bar.
    // These are two prompts with two thresholds; while they disagree a post
    // bounces between quarantine and republish every night. The stricter audit
    // gets the last word.
    const second = await auditHeroImage({
      url: cand.url, title: data.title, category: data.category,
      region: data.region, country: data.country || '',
    });
    if (second.verdict === 'MISMATCH') {
      console.log(`   ${slug}: selection passed but the audit rejects it (${second.reason}) — skipping`);
      continue;
    }
    if (second.verdict === 'UNKNOWN') {
      // Could not check ≠ approved.
      visionOutage = true;
      console.log(`   ${slug}: audit could not judge this candidate (${second.reason}) — leaving as is`);
      continue;
    }
    if (DRY) { console.log(`  · would fix ${slug} ← ${cand.url.slice(0, 70)}`); done = true; fixed++; break; }
    data.heroImage = { url: cand.url, credit: cand.credit, license: cand.license, source: cand.source };
    // The in-body photo was chosen earlier, from the same pool of candidates, so
    // a replacement hero can land on the picture already sitting in the gallery —
    // and then the post shows one photo twice while claiming two. It happened on
    // 17 posts before anything checked. Drop the gallery entry rather than the
    // hero: the hero is the better-verified of the two, and a post with one real
    // photo is the outcome the rules already allow. The gallery backfill can fill
    // the slot again later with something different.
    if (Array.isArray(data.gallery)) {
      const kept = data.gallery.filter((g) => g?.url !== cand.url);
      if (kept.length !== data.gallery.length) {
        console.log(`   ${slug}: dropped in-body photo — it is now the hero`);
      }
      if (kept.length) data.gallery = kept;
      else delete data.gallery;
    }
    const wasDraft = data.draft === true;
    if (wasDraft) delete data.draft;
    let out = `---\n${yaml.dump(data, { lineWidth: -1, noRefs: true, sortKeys: false })}---\n${content}`;
    // draft:true carries no reason, and this patrol used to treat every draft
    // it could re-photo as a PHOTO quarantine — on 2026-07-31 it republished
    // two posts the publish gate had held for hours contradictions. A fixed
    // photo lifts only the photo hold: re-run the other gate's check and keep
    // the draft when the prose still fights the fact box.
    const otherHolds = wasDraft ? hoursProblems(out) : [];
    if (otherHolds.length) {
      data.draft = true;
      out = `---\n${yaml.dump(data, { lineWidth: -1, noRefs: true, sortKeys: false })}---\n${content}`;
    }
    await writeFile(path, out, 'utf8');
    used.add(cand.url);
    fixed++;
    if (wasDraft && otherHolds.length) console.log(`  ✅ ${slug}: photo FIXED, but kept quarantined — ${otherHolds[0]}`);
    else if (wasDraft) { undrafted++; console.log(`  ✅ ${slug}: FIXED + republished (${vis.reason})`); }
    else console.log(`  ✅ ${slug}: FIXED (${vis.reason})`);
    done = true;
    break;
  }
  if (done) {
    delete retryCount[slug];               // a success resets the retirement clock
  }
  if (!done && visionOutage) {
    // The night proved nothing: candidates existed but the checker was down.
    // Advancing the retirement clock here is how a one-week Anthropic outage
    // retires every healthy draft; leave the count and the post alone.
    console.log(`  ⏸️  ${slug}: vision outage during candidate checks — night not counted`);
  }
  if (!done && !visionOutage) {
    unfixed++;
    rewriteList.push(slug);
    retryCount[slug] = (retryCount[slug] ?? 0) + 1;
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

// ── Retirement: seven consecutive empty nights and a quarantined post leaves
// the repo — its URL 301s to the region hub (astro.config reads the retired
// list), its translations go with it, and the country-fill replaces the slot
// with a venue that has photos. Guard rails: only draft:true files are ever
// deleted, and the live-page count cannot change by construction.
const retiredNow = [];
if (!DRY) {
  for (const [slug, n] of Object.entries(retryCount)) {
    if (n < RETIRE_AFTER) continue;
    const p = `src/content/posts/${slug}.md`;
    if (!existsSync(p)) { delete retryCount[slug]; continue; }
    let fm;
    try { fm = matter(readFileSync(p, 'utf8')).data; } catch { continue; }
    if (fm.draft !== true) { delete retryCount[slug]; continue; }   // never a live page

    const retired = JSON.parse(await readFile('data/retired-posts.json', 'utf8'));
    retired.push({ slug, region: fm.region ?? '', country: fm.country ?? '' });
    await writeFile('data/retired-posts.json', JSON.stringify(retired, null, 1) + '\n', 'utf8');

    const { unlink } = await import('node:fs/promises');
    await unlink(p);
    for (const l of ['ko', 'ja', 'es', 'zh']) {
      const t = `src/content/i18n/${l}/${slug}.md`;
      if (existsSync(t)) await unlink(t);
    }
    delete retryCount[slug];
    retiredNow.push(slug);
    console.log(`  🗑️  ${slug}: retired after ${n} empty nights — URL 301s to its region`);
  }
}
if (!DRY) await writeFile(RETRY_FILE, JSON.stringify(retryCount, null, 1) + '\n', 'utf8');

console.log(`\n📦 scanned ${scanned} target(s): ${fixed} fixed · ${undrafted} republished · ${unfixed} need venue-rewrite`);
if (rewriteList.length) console.log('REWRITE_LIST ' + rewriteList.join(','));
if (retiredNow.length) console.log('RETIRED_LIST ' + retiredNow.join(','));
console.log(`ALT_SUMMARY fixed=${fixed} undrafted=${undrafted} unfixed=${unfixed} retired=${retiredNow.length}`);
