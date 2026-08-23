// ─────────────────────────────────────────────────────────────
//  ALTERNATIVE VENUE-PHOTO SOURCES — Google Places photo access is blocked at
//  the billing level (hidden ~120/day cap + media withheld; see memory
//  wander-atlas-photo-diagnosis-pending), so real venue photos come from:
//   • Foursquare Places (user-uploaded photos of the ACTUAL venue; free tier
//     far above our volume) — env FOURSQUARE_API_KEY
//   • Flickr geotagged CC-licensed photos (name + lat/lng radius search;
//     3,600 req/h free) — env FLICKR_API_KEY
//  Both return candidates in the site's standard hero shape; EVERY candidate
//  must still pass scripts/lib/vision-check.mjs before it is written — the
//  source only supplies candidates, the AI vision gate decides.
// ─────────────────────────────────────────────────────────────

// Foursquare has TWO auth generations: new "Service API Keys" (Bearer + the
// places-api.foursquare.com host + a version header) and legacy v3 keys (raw
// Authorization on api.foursquare.com/v3). Detect once per process by trying
// new-style first and falling back — whichever key type the console issued
// just works.
let fsqMode = null; // 'new' | 'legacy' | 'dead'
async function fsqFetch(pathAndQuery) {
  const key = process.env.FOURSQUARE_API_KEY;
  const tryNew = () => fetch(`https://places-api.foursquare.com${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${key}`, 'X-Places-Api-Version': '2025-06-17', Accept: 'application/json' },
  });
  const tryLegacy = () => fetch(`https://api.foursquare.com/v3${pathAndQuery}`, {
    headers: { Authorization: key, Accept: 'application/json' },
  });
  if (fsqMode === 'new') return tryNew();
  if (fsqMode === 'legacy') return tryLegacy();
  let res = await tryNew();
  if (res.status !== 401 && res.status !== 403) { fsqMode = 'new'; console.log('  [fsq] new-style Service Key auth OK'); return res; }
  res = await tryLegacy();
  if (res.status !== 401 && res.status !== 403) { fsqMode = 'legacy'; console.log('  [fsq] legacy v3 key auth OK'); return res; }
  fsqMode = 'dead';
  console.log(`  [fsq] BOTH auth styles rejected (last ${res.status}) — check the key`);
  return res;
}

// ── Venue-name identity matching (shared by Foursquare and Flickr) ──────────
// Generic hospitality words prove nothing — "NAM Kitchen" once matched
// "Three Spice Thai Kitchen" on 'kitchen' alone. Identity needs a
// DISTINCTIVE token (or full-name containment). ONE list for both matchers:
// it used to live as two near-identical copies and only one would get fixed.
const GENERIC = new Set(['cafe', 'coffee', 'restaurant', 'the', 'and', 'bar', 'house', 'shop', 'store',
  'food', 'kitchen', 'market', 'park', 'museum', 'beach', 'street', 'grill', 'garden', 'club', 'center',
  'centre', 'hotel', 'lounge',
  // Added 2026-07-28: 'Tonkin Specialty Coffee' matched 'Shin Specialty Coffee'
  // on the word 'specialty' alone. These describe a category, never a venue.
  'specialty', 'speciality', 'roasters', 'roastery', 'bakery', 'bistro', 'eatery', 'diner', 'branch',
  'village', 'viewpoint', 'view', 'night', 'day', 'walking', 'traditional', 'heritage', 'original',
  // Added 2026-08-07: nationality/cuisine adjectives, SEO descriptors, and
  // neighboring-business types name a CATEGORY, not a venue — "The Island
  // Bangkok – Top Rated Thai Restaurant & Bar" (rank 4.7, 304 impressions)
  // matched "Baan Sabai Thai Massage" 71m away on 'thai' alone and the post
  // got quarantined. 'local' is deliberately absent: two published venues are
  // literally named "Local Restaurant in <city>" (corpus sweep 2026-08-07);
  // known cost of this batch is "French Market"-style landmarks, which refuse
  // here (no photo — safe) and are covered by Commons instead.
  'thai', 'korean', 'japanese', 'chinese', 'vietnamese', 'italian', 'french', 'indian',
  'mexican', 'filipino', 'malay', 'malaysian', 'indonesian', 'singaporean', 'taiwanese',
  'cantonese', 'spanish', 'greek', 'turkish', 'lebanese', 'balinese', 'khmer', 'burmese',
  'asian', 'western',
  'top', 'rated', 'best', 'famous', 'authentic',
  'massage', 'spa']);

// Script-aware, space-insensitive flattening: hangul/kana/thai names match too
// ("주문진 등대" ↔ "Jumunjin Lighthouse (주문진등대)").
const flatName = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC')
  .replace(/[^a-z0-9가-힣ぁ-ヶ一-鿿ก-๛]/g, '');
const splitTokens = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC')
  .split(/[^a-z0-9가-힣ぁ-ヶ一-鿿ก-๛]+/).filter(Boolean);

// The city/country the search was scoped to proves nothing about WHICH venue
// this is — every result shares it. 'Garden to Table Chiangmai' matched a
// Chiang Mai walking street on the token 'chiangmai' alone (2026-07-28).
// "Chiang Mai, Thailand" must also block the one-word spelling a venue name
// uses ("Garden to Table Chiangmai"), so the joined form goes in too.
const placeStopwords = (near) => {
  const nearRaw = String(near || '').toLowerCase();
  const stop = new Set(nearRaw.split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
  for (const part of nearRaw.split(',')) {
    const joined = part.replace(/[^a-z0-9]/g, '');
    if (joined.length >= 3) stop.add(joined);
  }
  return stop;
};

// The venue-name tokens that actually IDENTIFY it: generic/category words and
// the search area's own name stripped out. Empty result = nothing to verify
// identity with, so callers must refuse to match at all.
export function distinctiveTokens(name, near) {
  const stop = placeStopwords(near);
  return splitTokens(name).filter((w) => w.length >= 3 && !GENERIC.has(w) && !stop.has(w));
}

// Pick the search result that shares venue IDENTITY with `name`, or null.
// NAME MATCH ONLY — proximity is NOT identity (the 150m fallback once put
// the ssambap shop NEXT DOOR onto the Manseok Dakgangjeong post; vision
// can't tell two Korean restaurants apart from a table photo). Among matching
// results the MOST shared distinctive tokens wins, not FSQ rank: "Nami Island"
// took "Gamja Island" over the real "Nami Island (남이섬)" when first-match
// ruled and the impostor sorted first (live repro 2026-08-07).
export function pickVenueHit(name, near, results) {
  const ourTokens = distinctiveTokens(name, near);
  if (!ourTokens.length) return null;
  const stop = placeStopwords(near);
  const oursFlat = flatName(name);
  let best = null, bestScore = 0;
  for (const r of results || []) {
    const rf = flatName(r.name);
    if (!rf) continue;
    // Token match must be on a WORD boundary of the result, not a substring of
    // the flattened blob: "NAM Kitchen" matched "Vietnam Kitchen" because
    // 'nam' sits inside 'vietnam', and "Sen Restaurant" matched "Essence".
    const theirTokens = new Set(splitTokens(r.name));
    let score = ourTokens.filter((t) => theirTokens.has(t)).length;
    // Whole-name containment used to skip the stopword rules entirely, so
    // "Kin Specialty Coffee" passed for "Tonkin Specialty Coffee". Require the
    // contained name to carry a distinctive token of its own.
    if (!score && rf.length >= 3 && oursFlat.includes(rf)) {
      score = [...theirTokens].filter((t) => t.length >= 3 && !GENERIC.has(t) && !stop.has(t) && ourTokens.includes(t)).length;
    }
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

// The name Google stores is often a billboard — "Vandal Restaurant | Elevated
// Global Street Food", "Vietnamese Food - Hue Local Food & FastFood 22
// Restaurant (Huế)" — and Foursquare's search, which wants the name a venue
// registered, returns NOTHING for it. 17 of 19 restored guides drew "0
// tried" on 2026-08-23 for exactly this. The query is the part before the
// first " | ", " – ", " — " or " - " and before any "(…)", as long as that
// part still carries a distinctive token; identity matching (pickVenueHit)
// keeps using the FULL name, so a shorter query cannot admit a wrong venue.
export function venueQuery(name, near) {
  const full = String(name || '').trim();
  const head = full.split(/\s+[|–—-]\s+/)[0].replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return head && head !== full && distinctiveTokens(head, near).length ? head : full;
}

// Foursquare: match the venue by name near its stored coordinates, then pull
// its photos. Returns [] when no key, no confident match, or no photos.
export async function fsqVenuePhotos({ name, lat, lng, near, limit = 4 }) {
  const key = process.env.FOURSQUARE_API_KEY;
  if (!key || !name) return [];
  if (lat == null && !near) return [];
  try {
    // Coordinates when we have them (Google-sourced venue posts); otherwise a
    // "near" text anchor ("Bali, Indonesia") — covers web-discovered trendy
    // spots that carry no place object (the Cure Bali / Pak Gula blind spot).
    const search = (query) => fsqFetch(`/places/search?${lat != null
      ? new URLSearchParams({ query, ll: `${lat},${lng}`, radius: '400', limit: '3' })
      : new URLSearchParams({ query, near, limit: '3' })}`);
    const short = venueQuery(name, near);
    let res = await search(short);
    if (!res.ok) {
      // Diagnose silently-failing searches ONCE (a 400 here looked like "auth
      // OK, zero candidates" and produced a 0-fix full run).
      if (!fsqVenuePhotos._logged) {
        fsqVenuePhotos._logged = true;
        console.log(`  [fsq] search FAILED ${res.status}: ${(await res.text().catch(() => '')).slice(0, 250)}`);
      }
      return [];
    }
    let body = await res.json();
    // The short query is the likelier hit; the full billboard name is the
    // fallback, not the other way round.
    if (!(body.results || []).length && short !== name) {
      const full = await search(name);
      if (full.ok) body = await full.json();
    }
    if (!fsqVenuePhotos._shape) {
      fsqVenuePhotos._shape = true;
      console.log(`  [fsq] first search OK — keys: ${Object.keys(body).join(',')} · results: ${(body.results || []).length}`);
      if ((body.results || [])[0]) console.log(`  [fsq] first result keys: ${Object.keys(body.results[0]).join(',').slice(0, 150)}`);
    }
    const results = body.results || [];
    // Confidence: a result must share venue IDENTITY with ours (the vision
    // gate still has the final say — this just avoids junk lookups). The
    // matcher itself is pickVenueHit() above, extracted so tests can replay
    // real incidents against it without the network.
    if (!distinctiveTokens(name, near).length) {
      // Nothing distinctive left (e.g. 'The Coffee House Bangkok'): any hit would
      // rest on generic or city words, which is exactly how wrong venues got in.
      console.log(`  [fsq] "${name}" has no distinctive token after stopwords — refusing a name match`);
      return [];
    }
    const hit = pickVenueHit(name, near, results);
    if (!hit) {
      if (!fsqVenuePhotos._nohit) { fsqVenuePhotos._nohit = true; console.log(`  [fsq] no hit for "${name}" — results were: ${results.map((r) => r.name + '@' + r.distance + 'm').join(' | ').slice(0, 160)}`); }
      return [];
    }
    const placeId = hit.fsq_place_id || hit.fsq_id; // new API vs legacy field name
    const pres = await fsqFetch(`/places/${placeId}/photos?limit=${limit}`);
    if (!pres.ok) {
      if (!fsqVenuePhotos._pfail) { fsqVenuePhotos._pfail = true; console.log(`  [fsq] photos FAILED ${pres.status}: ${(await pres.text().catch(() => '')).slice(0, 200)}`); }
      return [];
    }
    const photos = await pres.json();
    if (!fsqVenuePhotos._pshape) { fsqVenuePhotos._pshape = true; console.log(`  [fsq] first photos OK — isArray:${Array.isArray(photos)} len:${Array.isArray(photos) ? photos.length : Object.keys(photos).join(',')}`); }
    // Foursquare photos are phone uploads, so most are portrait — and the hero
    // slot crops to 16:9, which takes a 1080×1920 shot and throws away most of
    // it, frequently the part that identified the place. A landscape frame of the
    // same venue survives that crop intact, so landscape sorts first while
    // portrait stays available for venues that have nothing else.
    return (photos || [])
      .map((p) => ({
        url: `${p.prefix}original${p.suffix}`,
        credit: `Photo: Foursquare user content (${hit.name})`,
        license: 'foursquare',
        source: `https://foursquare.com/v/${placeId}`,
        w: p.width || 0,
        h: p.height || 0,
      }))
      .sort((a, b) => {
        // Google Discover only serves large cards from images ≥1200px wide, and
        // the hero doubles as og:image — so Discover-eligible photos outrank the
        // rest, with the existing landscape preference as the tiebreak.
        const wide = (x) => (x.w ? (x.w >= 1200 ? 0 : 1) : 0.5); // unknown sits between
        const land = (x) => (x.w && x.h ? (x.w > x.h ? 0 : 1) : 0.5);
        return wide(a) - wide(b) || land(a) - land(b);
      });
  } catch {
    return [];
  }
}

// Flickr: CC-licensed photos taken AT the venue (geo radius + text). License
// ids: 1,2,3,4,5,6 = CC family; 7 = no known restrictions; 9,10 = CC0/PDM.
const FLICKR_LICENSES = '1,2,3,4,5,6,7,9,10';
const LICENSE_LABEL = {
  1: 'CC BY-NC-SA 2.0', 2: 'CC BY-NC 2.0', 3: 'CC BY-NC-ND 2.0',
  4: 'CC BY 2.0', 5: 'CC BY-SA 2.0', 6: 'CC BY-ND 2.0',
  7: 'No known copyright restrictions', 9: 'CC0', 10: 'Public Domain Mark',
};

// DORMANT BY DECISION, not by accident: the Flickr API is paid, so no key is
// configured and none should be requested — that is the whole reason Openverse
// (which indexes Flickr's CC photos for free) was added below. Proposing "just
// get a Flickr key" re-litigates a settled verdict; it happened once on
// 2026-08-15 and the owner had to correct it.
export async function flickrPhotos({ name, lat, lng, near, limit = 4 }) {
  const key = process.env.FLICKR_API_KEY;
  if (!key || !name) return [];
  // Flickr had NO identity check at all: a relevance search returned whatever
  // matched loosely, and with no lat/lng it searched the whole world. Every
  // guard in this file protected only the Foursquare branch, so the fallback
  // path — the common one, since FSQ often has nothing — was unguarded.
  // The stopword list is the shared GENERIC one above: it was once a separate
  // copy here (GENERIC_F) and only the FSQ copy got new additions.
  const wordsOf = splitTokens;
  const ourWords = distinctiveTokens(name, near);
  if (!ourWords.length) return [];  // nothing distinctive to verify against
  if (lat == null || lng == null) return [];  // a global text search is not evidence of place
  try {
    const q = new URLSearchParams({
      method: 'flickr.photos.search',
      api_key: key,
      text: name,
      license: FLICKR_LICENSES,
      content_types: '0', // photos only
      media: 'photos',
      sort: 'relevance',
      per_page: String(limit),
      extras: 'url_h,url_k,url_l,url_o,owner_name,license',
      format: 'json',
      nojsoncallback: '1',
    });
    if (lat != null && lng != null) {
      q.set('lat', String(lat)); q.set('lon', String(lng)); q.set('radius', '1');
    }
    const res = await fetch(`https://api.flickr.com/services/rest/?${q}`);
    if (!res.ok) return [];
    const j = await res.json();
    return (j.photos?.photo || [])
      // The photo's own title must carry one of the venue's distinctive words —
      // proximity alone puts every neighbouring shop's photo in range.
      .filter((p) => {
        const t = new Set(wordsOf(p.title || ''));
        return ourWords.some((w) => t.has(w));
      })
      .map((p) => ({
        // h (1600px) first: url_l tops out at 1024, below Google Discover's
        // 1200px large-card minimum. k (2048) next; o (original) can be a
        // multi-MB LCP so it stays the last resort alongside l.
        url: p.url_h || p.url_k || p.url_l || p.url_o,
        credit: `Photo: ${p.ownername} / Flickr (${LICENSE_LABEL[p.license] || 'CC'})`,
        license: 'flickr-cc',
        source: `https://www.flickr.com/photos/${p.owner}/${p.id}`,
      }))
      .filter((p) => p.url);
  } catch {
    return [];
  }
}

// ── Openverse (api.openverse.org) — free CC-image index that covers Flickr,
// Wikimedia, SMK and others. Added 2026-08-08 when Flickr moved API keys
// behind a PRO subscription: this reaches Flickr's CC photos without one.
// No geo filter exists here, so identity leans entirely on the distinctive-
// token match (title/tags) plus the near-name in the query; every candidate
// still faces the vision gate + audit like the rest. Licenses are DELIBERATELY
// narrower than FLICKR_LICENSES: by/by-sa/cc0/pdm only — this is a commercial
// site, and an NC photo is a licensing claim waiting to happen.
export async function openversePhotos({ name, near, limit = 4 }) {
  if (!name) return [];
  const ourWords = distinctiveTokens(name, near);
  if (!ourWords.length) return [];
  try {
    const q = new URLSearchParams({
      q: near ? `${name} ${near}` : name,
      license: 'by,by-sa,cc0,pdm',
      page_size: String(Math.max(limit * 3, 10)), // room to filter by identity
    });
    const res = await fetch(`https://api.openverse.org/v1/images/?${q}`, {
      headers: { 'User-Agent': 'WanderAtlasBot/1.0 (https://wanderatlasguides.com)' },
    });
    if (!res.ok) return []; // 429 (anonymous rate cap) or outage: just no candidates tonight
    const j = await res.json();
    return (j.results || [])
      .filter((r) => {
        const t = new Set(splitTokens(`${r.title || ''} ${(r.tags || []).map((x) => x?.name || '').join(' ')}`));
        return ourWords.some((w) => t.has(w));
      })
      // Below Discover's 1200px large-card bar a photo costs a queue slot later.
      .filter((r) => (r.width || 0) >= 1024)
      .slice(0, limit)
      .map((r) => ({
        url: r.url,
        credit: `Photo: ${r.creator || 'unknown'} / ${r.source || 'Openverse'} (${String(r.license || 'cc').toUpperCase()})`,
        license: 'openverse-cc',
        source: r.foreign_landing_url || r.url,
      }))
      .filter((p) => p.url);
  } catch {
    return [];
  }
}

// Ordered candidate stream for one venue — Foursquare (actual venue) first,
// Flickr geo (taken at the spot) second, Openverse (CC index, incl. Flickr's
// CC photos, no key needed) last.
export async function venuePhotoCandidates({ name, lat, lng, near }) {
  const out = [];
  out.push(...(await fsqVenuePhotos({ name, lat, lng, near })));
  out.push(...(await flickrPhotos({ name, lat, lng, near })));
  out.push(...(await openversePhotos({ name, near })));
  return out;
}
