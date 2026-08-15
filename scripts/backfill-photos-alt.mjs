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
import { isPatrolTarget, isPhotolessLive } from './lib/patrol-target.mjs';
import { judgeCandidate, loadWorld } from './lib/commons-identity.mjs';

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
const vmismatchUrls = new Map(); // slug → Set(url judged MISMATCH or WEAK)
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
      // WEAK counts too. The vision gate returns three verdicts and only
      // MISMATCH was ever acted on, so a hero judged "generic beverage photo,
      // no venue context visible" sat on the page indefinitely — not wrong
      // enough to quarantine, not good enough to keep, and nothing in the
      // pipeline looking for better (found 2026-08-06). Queuing it is safe:
      // the patrol only SWAPS when the replacement clears the same vision
      // gate, so a weak hero can never be traded for a worse one.
      const verdict = (item.verdict || item.status || '').toUpperCase();
      if (!verdict.includes('MISMATCH') && !verdict.includes('WEAK')) continue;
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

const world = await loadWorld();
const used = await loadUsedImageUrls(POSTS);
const files = (await readdir(POSTS)).filter((f) => f.endsWith('.md'));
let fixed = 0, undrafted = 0, unfixed = 0, scanned = 0;
const rewriteList = [];
// Consecutive nightly failures per slug. Seven strikes stops the search: these
// are small venues (a café in Yana, a noodle stall) that no free photo source
// has ever covered, and after a week of the same empty answer another attempt
// is only a vision-API bill.
//
// Seven strikes used to DELETE the post. It now only stops searching — see the
// block near the bottom of this file for the measurement that changed the rule.
const RETRY_FILE = 'data/photo-retry.json';
const GIVE_UP_AFTER = 7;
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
  // …except a live post with NO hero at all: the released-photoless events
  // (51 on 2026-08-10) matched neither "draft" nor "placeholder" and were
  // invisible to every patrol — the owner kept meeting their blank cards.
  // Filling one removes it from this set, so the vision bill self-limits.
  //
  // The event-only version of this let the same gap re-open for venues on
  // 2026-08-14: the identity strip removed eleven wrong-place heroes, and six
  // of the eleven then matched no condition here at all — published, showing
  // nothing, with no path back. See scripts/lib/patrol-target.mjs.
  const photolessLive = isPhotolessLive({ draft: data.draft, heroUrl: data.heroImage?.url });
  if (isEvent && data.draft !== true && !ONLY.includes(slug) && !photolessLive) continue;
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
  const isTarget = isPatrolTarget({
    draft: data.draft,
    heroUrl: data.heroImage?.url || '',
    flaggedNow,
    auditAll: process.env.AUDIT_ALL === '1',
    named: ONLY.length > 0,
  });
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
      // Overwrite with MATCH rather than delete (2026-08-08): a deleted entry
      // reads as never-checked, so validate-content flagged freshly-acquitted
      // heroes as UNVERIFIED-PHOTO the same evening.
      if (flaggedNow) { acquitted.push(slug); }
      if (auditStore && (flaggedNow || !auditStore[`${slug}\x01${data.heroImage.url}`])) {
        auditStore[`${slug}\x01${data.heroImage.url}`] =
          { slug, verdict: 'MATCH', reason: `patrol re-check: ${String(cur.reason || 'approved').slice(0, 150)}`, at: new Date().toISOString() };
        auditDirty = true;
      }
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
    // Same exclusion the generator's resolveHero applies in event mode: the
    // event's own city/country is where, not what — never the anchor.
    const anchor = keyToken(venueName, `${data.region || ''} ${data.country || ''}`);
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
    // THE IDENTITY GATE. Both prompts above judge whether the picture looks like
    // the right KIND of place; neither can say WHICH place, and both approve a
    // photograph of the restaurant next door every time. On 2026-08-14 an
    // identity sweep removed eleven wrong-venue heroes and a patrol run an hour
    // later put SEVEN of them straight back — Mumbai onto Daegu, a Hong Kong
    // congee kitchen onto Gardena, El Nacional onto Barra Oso, Bismillah onto
    // Chola. Vision approved all seven. The metadata rejected all seven.
    //
    // The verdict-store check above could not help: it only knows photos judged
    // against THIS post, and the identity sweep recorded nothing. That is fixed
    // too (audit-photo-identity now writes its removals to the store), but this
    // gate is the one that also covers a candidate no one has ever tried.
    const ident = await judgeCandidate(cand, { country: data.country || '', region: data.region, venueName }, world);
    if (ident.verdict === 'contradicts') {
      console.log(`   ${slug}: identity rejects it (${ident.why}) — skipping`);
      continue;
    }
    if (DRY) { console.log(`  · would fix ${slug} ← ${cand.url.slice(0, 70)}`); done = true; fixed++; break; }
    data.heroImage = { url: cand.url, credit: cand.credit, license: cand.license, source: cand.source, ...(vis.focus ? { focus: vis.focus } : {}) };
    // The verdict store is what validate-content trusts: without this line the
    // patrol's own vision-approved replacements were reported as UNVERIFIED-
    // PHOTO the same evening (2026-08-08, nine of them).
    if (auditStore) {
      auditStore[`${slug}\x01${cand.url}`] =
        { slug, verdict: second.verdict, reason: `patrol replace: ${String(second.reason || 'approved').slice(0, 150)}`, at: new Date().toISOString() };
      auditDirty = true;
    }
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

// ── Seven empty nights: the search stops. NOTHING IS DELETED.
//
// This block used to delete the file, its translations, and add the slug to a
// 301 list. That is what happened to 92 posts on 2026-07-26, and measured
// against Search Console afterwards, the URLs killed that week had carried
// 39.9% of the site's impressions and 42.9% of its clicks in the five days
// before. Five of the top eight pages went with them — kuala-lumpur-muljil was
// ranking 4.9th and earning clicks the day it was removed. The next morning
// the site's average position fell from 12 to 57 and has not recovered.
//
// Deletion is irreversible and bought nothing: a quarantined post is already
// invisible, so removing the file changes no reader's experience and only
// destroys the option to fix it later. The clock now just stops. The post
// stays quarantined, the file stays in the repo, and a human decides.
//
// Deliberately NOT auto-publishing these either. A venue guide without a photo
// is a weak page — the reader wants to see the café — so publishing photoless
// is a judgement call per post, not a rule (owner, 2026-08-07). Events are the
// exception and have their own path (release-photoless-events.mjs): a reader
// searching an event wants the date, venue and tickets, all of which are on
// the page. For venues, the 22 quarantined posts that actually draw search
// impressions were released by hand; the other 86 draw none, so keeping them
// down costs nothing and leaves the photo hunt running.
const exhaustedNow = [];
for (const [slug, n] of Object.entries(retryCount)) {
  if (n < GIVE_UP_AFTER) continue;
  const p = `${POSTS}/${slug}.md`;
  if (!existsSync(p)) { delete retryCount[slug]; continue; }
  let fm;
  try { fm = matter(readFileSync(p, 'utf8')).data; } catch { continue; }
  if (fm.draft !== true) { delete retryCount[slug]; continue; }   // already live again
  exhaustedNow.push(slug);
  console.log(`  ⏸️  ${slug}: no photo after ${n} nights — search paused, post kept (was: deleted)`);
}
if (!DRY) await writeFile(RETRY_FILE, JSON.stringify(retryCount, null, 1) + '\n', 'utf8');

console.log(`\n📦 scanned ${scanned} target(s): ${fixed} fixed · ${undrafted} republished · ${unfixed} need venue-rewrite`);
if (rewriteList.length) console.log('REWRITE_LIST ' + rewriteList.join(','));
if (exhaustedNow.length) console.log('EXHAUSTED_LIST ' + exhaustedNow.join(','));
console.log(`ALT_SUMMARY fixed=${fixed} undrafted=${undrafted} unfixed=${unfixed} exhausted=${exhaustedNow.length}`);
