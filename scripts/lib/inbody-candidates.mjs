// ─────────────────────────────────────────────────────────────
//  CANDIDATES FOR THE SECOND PHOTO (gallery[0], shown inside the prose)
//
//  One place for the three callers — generate.mjs at publish, discover-events
//  at publish, backfill-gallery weekly — so the sources cannot drift apart.
//  The gate stays with the caller (verifyGalleryImage, hedged = no); this only
//  decides what is offered to it, and in what order.
//
//  Why it exists (2026-10-17, 픽서님: "모든 글에 사진이 가급적 2장"): of 720
//  posts published since 10-01 only 34% had a second photo.
//   - A venue post looked at ONE Commons file. commonsBest returns its best
//     match, and when vision refused it (a sign at the gate, the wrong building
//     on the same square) nothing else from Commons was ever offered — Roath
//     Park and the Kongresshalle, both richly photographed, shipped with one.
//     Now up to three, each the next-best after the ones already refused.
//   - An event post never tried at all: discover-events wrote `gallery: []`
//     and the weekly patrol skipped the category. 305 of 305 events since
//     10-01 had a single photo. Events now draw from the same identity-by-
//     membership sources their hero does: the act's Commons category, then
//     the event's own (past editions).
//
//  Both are async generators: the next source is only queried when the caller
//  asks for another candidate, so a first-try pass costs what it always did.
// ─────────────────────────────────────────────────────────────
import { commonsBest, tokens, allWords, keyToken, performerCategoryPhotos, eventCategoryPhotos } from './commons.mjs';
import { venuePhotoCandidates, DINING_CATEGORY } from './photo-sources.mjs';
import { isUsedImage, markUsedImage } from './hero-url.mjs';

export const COMMONS_TRIES = 3;
export const VENUE_PHOTO_TRIES = 3;
export const EVENT_TRIES = 4;
// A sight rather than a business: attractions, and any post whose hero came
// from Commons (an encyclopedia photographs towers, not coffee shops) — unless
// the subject's own name says it is food or drink. "Ben Nghe Street Food" is
// filed as an attraction and "Chuồn Chuồn Bistro & Bar" has a Commons hero;
// their Foursquare food photos are the place itself, not a namesake. A
// restaurant or trendy guide is a business by definition, whatever its hero:
// 101 of them have a Commons hero (Tim Ho Wan, Les Deux Magots), and calling
// them landmarks switched off their own Foursquare photos (review, 10-17).
export const isLandmarkPost = (category, heroLicense, name = '') =>
  category !== 'restaurant' && category !== 'trendy' &&
  (category === 'attraction' || heroLicense === 'wikimedia') && !DINING_CATEGORY.test(String(name));

// An unsure vision verdict is a rejection — one correct hero beats a doubtful pair.
export const HEDGED = /probabl|plausib|likely|appears to|could be|maybe|possibly/i;

/**
 * Venue/landmark candidates: Commons #1, the venue's own photos, then Commons
 * #2 and #3. `why` collects a reason for every empty source.
 * `landmark`: the subject is a sight, not a business — Foursquare food/drink
 * namesakes are refused (see isDiningHit in lib/photo-sources).
 */
export async function* venueInBodyCandidates({ name, region, country = '', lat = null, lng = null, heroUrl, landmark = false }, why = []) {
  const used = new Set();
  markUsedImage(used, heroUrl);
  const near = lat != null && lng != null ? { lat, lng } : null;
  const nextCommons = async () => {
    try {
      const wiki = await commonsBest(`${name} ${region}`, {
        used,
        minWidth: 1200,
        crossCheck: tokens(`${name} ${region}`),
        minCross: 2,
        // Only files shot near the venue (commons SAME_PLACE_KM): 10-11
        // Matsuyama Castle's gallery got Bitchu Matsuyama Castle, 150 km away.
        near,
        // A city-and-kind name ("Ulaanbaatar Park") is identity only as the
        // unbroken phrase — see placeKindOnly in lib/commons (2026-10-12).
        subject: name,
        region,
      });
      if (!wiki?.url) return null;
      markUsedImage(used, wiki.url);
      return { ...wiki, license: 'wikimedia' };
    } catch (e) {
      why.push(`commons error: ${String(e.message).slice(0, 40)}`);
      return null;
    }
  };

  const first = await nextCommons();
  if (first) yield first;
  else if (!why.some((w) => w.startsWith('commons error'))) why.push('commons: no match ≥1200px');

  try {
    let n = 0;
    for (const c of await venuePhotoCandidates({ name, lat, lng, near: country ? `${region}, ${country}` : region, landmark })) {
      if (!c.url || isUsedImage(used, c.url)) continue;
      markUsedImage(used, c.url);
      n++;
      yield c;
      if (n >= VENUE_PHOTO_TRIES) break;
    }
    if (!n) why.push('venue photos: none');
  } catch (e) { why.push(`venue photos error: ${String(e.message).slice(0, 40)}`); }

  if (!first) return; // no first match → there is no "next best" either
  for (let i = 1; i < COMMONS_TRIES; i++) {
    const c = await nextCommons();
    if (!c) break;
    yield c;
  }
}

/** Does a Commons file title name the act (every word) or the event's key word? */
export function namesEventSubject(title = '', { performer = '', name = '', region = '' } = {}) {
  if (/\bcosplay/i.test(title)) return false;
  const t = new Set(allWords(title));
  const act = allWords(performer);
  const key = keyToken(name, region);
  return (act.length > 0 && act.every((w) => t.has(w))) || (Boolean(key) && t.has(key));
}

/**
 * Event candidates: the performer's own Commons category, then the event's
 * (past editions, newest first). Membership is the identity — the same proof
 * the event hero uses — so no text-search namesakes enter.
 *
 * Membership was not enough for a SECOND photo (patrol run, 2026-10-17): a
 * Yesung guide got a Super Junior frame with two other members in it (filed
 * under "Yesung in 2015"), a Hatsune Miku concert got a cosplay contest in
 * Copenhagen ("Cosplay of Hatsune Miku"). Vision cannot tell people apart, so
 * the file's own NAME must say who or what it shows: every word of the act,
 * or the event's key word. A hero with no doubt beats a pair with one.
 */
export async function* eventInBodyCandidates({ name, region, performer = '', heroUrl }, why = []) {
  const used = new Set();
  markUsedImage(used, heroUrl);
  let n = 0;
  const sources = [
    ['performer category', () => (performer ? performerCategoryPhotos(performer, { limit: 12 }) : [])],
    ['event category', () => eventCategoryPhotos(name, { region, limit: 12 })],
  ];
  const namesIt = (c) => namesEventSubject(c.title, { performer, name, region });
  for (const [label, load] of sources) {
    let list = [];
    try { list = await load(); } catch (e) { why.push(`${label} error: ${String(e.message).slice(0, 40)}`); continue; }
    let got = 0;
    for (const c of list) {
      if (n >= EVENT_TRIES) return;
      if (!c.url || isUsedImage(used, c.url)) continue;
      if (!namesIt(c)) continue; // free: no vision call for a file that does not name its subject
      markUsedImage(used, c.url);
      n++; got++;
      yield { ...c, license: c.license || 'wikimedia' };
    }
    if (!got && (label !== 'performer category' || performer)) why.push(`${label}: none`);
  }
}

/**
 * The first candidate that clears the gate, or null. One loop for every
 * caller so the bar cannot drift: not used on another post, vision says yes
 * without hedging, guardrails allow the licence. `verify(c)` is the caller's
 * verifyGalleryImage call (passed in so this file never imports the API client).
 */
export async function pickFirstPassing(candidates, { used, verify, allowed, why = [] }) {
  for await (const c of candidates) {
    const tag = c.license || 'cand';
    if (isUsedImage(used, c.url)) { why.push(`${tag}: already used on another post`); continue; }
    let v;
    try { v = await verify(c); } catch (e) { why.push(`${tag}: verify threw ${String(e.message).slice(0, 30)}`); continue; }
    const hedged = HEDGED.test(v?.reason || '');
    if (!v?.ok || hedged) { why.push(`${tag}: ${hedged ? 'hedged — ' : ''}${String(v?.reason || 'rejected').slice(0, 60)}`); continue; }
    const entry = { url: c.url, credit: c.credit, license: c.license, source: c.source };
    if (!allowed(entry)) { why.push(`${tag}: blocked by guardrails`); continue; }
    return { entry, reason: String(v.reason || 'approved') };
  }
  return null;
}
