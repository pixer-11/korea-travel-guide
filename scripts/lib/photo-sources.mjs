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

// Foursquare: match the venue by name near its stored coordinates, then pull
// its photos. Returns [] when no key, no confident match, or no photos.
export async function fsqVenuePhotos({ name, lat, lng, limit = 4 }) {
  const key = process.env.FOURSQUARE_API_KEY;
  if (!key || !name || lat == null || lng == null) return [];
  try {
    const q = new URLSearchParams({ query: name, ll: `${lat},${lng}`, radius: '400', limit: '3' });
    const res = await fsqFetch(`/places/search?${q}`);
    if (!res.ok) {
      // Diagnose silently-failing searches ONCE (a 400 here looked like "auth
      // OK, zero candidates" and produced a 0-fix full run).
      if (!fsqVenuePhotos._logged) {
        fsqVenuePhotos._logged = true;
        console.log(`  [fsq] search FAILED ${res.status}: ${(await res.text().catch(() => '')).slice(0, 250)}`);
      }
      return [];
    }
    const body = await res.json();
    if (!fsqVenuePhotos._shape) {
      fsqVenuePhotos._shape = true;
      console.log(`  [fsq] first search OK — keys: ${Object.keys(body).join(',')} · results: ${(body.results || []).length}`);
      if ((body.results || [])[0]) console.log(`  [fsq] first result keys: ${Object.keys(body.results[0]).join(',').slice(0, 150)}`);
    }
    const results = body.results || [];
    // Confidence: the top result's name must share a token with ours (the
    // vision gate still has the final say — this just avoids junk lookups).
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, '');
    const ours = new Set(norm(name).split(/\s+/).filter((w) => w.length > 2));
    const hit = results.find((r) => norm(r.name).split(/\s+/).some((w) => ours.has(w)));
    if (!hit) return [];
    const placeId = hit.fsq_place_id || hit.fsq_id; // new API vs legacy field name
    const pres = await fsqFetch(`/places/${placeId}/photos?limit=${limit}`);
    if (!pres.ok) return [];
    const photos = await pres.json();
    return (photos || []).map((p) => ({
      url: `${p.prefix}original${p.suffix}`,
      credit: `Photo: Foursquare user content (${hit.name})`,
      license: 'foursquare',
      source: `https://foursquare.com/v/${placeId}`,
    }));
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

export async function flickrPhotos({ name, lat, lng, limit = 4 }) {
  const key = process.env.FLICKR_API_KEY;
  if (!key || !name) return [];
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
      extras: 'url_l,url_o,owner_name,license',
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
      .map((p) => ({
        url: p.url_l || p.url_o,
        credit: `Photo: ${p.ownername} / Flickr (${LICENSE_LABEL[p.license] || 'CC'})`,
        license: 'flickr-cc',
        source: `https://www.flickr.com/photos/${p.owner}/${p.id}`,
      }))
      .filter((p) => p.url);
  } catch {
    return [];
  }
}

// Ordered candidate stream for one venue — Foursquare (actual venue) first,
// Flickr geo (taken at the spot) second.
export async function venuePhotoCandidates({ name, lat, lng }) {
  const out = [];
  out.push(...(await fsqVenuePhotos({ name, lat, lng })));
  out.push(...(await flickrPhotos({ name, lat, lng })));
  return out;
}
