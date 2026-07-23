// Google Places API (New) — text search + photo fetch.
// Docs: https://developers.google.com/maps/documentation/places/web-service
const KEY = process.env.GOOGLE_MAPS_API_KEY;
const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.businessStatus',
  'places.googleMapsUri',
  'places.location',
  'places.photos',
  'places.editorialSummary',
].join(',');

const PRICE_LEVEL_MAP = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

/**
 * Search for places by free-text query (e.g. "best bindaetteok in Seoul").
 * Returns a normalized array so the rest of the pipeline never touches raw API shapes.
 */
export async function searchPlaces(query, { max = 5 } = {}) {
  if (!KEY) throw new Error('GOOGLE_MAPS_API_KEY is not set');

  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: max, languageCode: 'en' }),
  });

  if (!res.ok) {
    throw new Error(`Places search failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return (data.places ?? []).map(normalizePlace);
}

// Re-fetch a single place by its stored id — used by the freshness job to
// detect rating changes and closures without re-running a text search.
export async function getPlaceById(placeId, { throwOnQuota = false, throwOnError = false } = {}) {
  if (!KEY || !placeId) return null;
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': FIELD_MASK.replaceAll('places.', ''),
      'Content-Type': 'application/json',
    },
  });
  // Let callers that backfill in bulk stop cleanly on quota; default stays lenient
  // (returns null) so the freshness job is unaffected.
  if (res.status === 429 && throwOnQuota) throw new Error(`Places details 429: ${await res.text()}`);
  if (!res.ok) {
    if (throwOnError) throw new Error(`Places details ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  return normalizePlace(await res.json());
}

// Fields needed ONLY to tell a genuine "hidden gem / locals' favourite" apart
// from a tourist-mobbed spot. Kept separate from FIELD_MASK because `reviews`
// makes this a pricier Details SKU, so we only pay for it once per PUBLISHED post.
const LOCAL_SIGNAL_MASK = [
  'id', 'rating', 'userRatingCount', 'primaryType', 'primaryTypeDisplayName', 'types', 'reviews',
].join(',');

/**
 * One extra Details call per published venue to gather the metadata behind the
 * "how to visit like a local" angle. We DELIBERATELY discard all review TEXT (we
 * never quote or paraphrase reviews — that would risk invention); we keep only
 * each review's language code + star rating as numeric signals. Returns null on
 * any error/quota so publishing never blocks on it.
 */
export async function fetchPlaceReviewSignals(placeId) {
  if (!KEY || !placeId) return null;
  let res;
  try {
    res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: {
        'X-Goog-Api-Key': KEY,
        'X-Goog-FieldMask': LOCAL_SIGNAL_MASK,
        'Content-Type': 'application/json',
      },
    });
  } catch { return null; }
  // Surface a Details-quota 429 instead of swallowing it — otherwise like-a-local
  // signals silently vanish from every post once the shared Places day is drained.
  if (res.status === 429) { console.warn('  ⚠ Places Details 429 — like-a-local signals skipped (details quota exhausted)'); return null; }
  if (!res.ok) return null;
  const p = await res.json();
  const reviewLangs = (p.reviews ?? [])
    .map((r) => r.originalText?.languageCode || r.text?.languageCode)
    .filter(Boolean)
    .map((l) => l.toLowerCase().split('-')[0]); // 'zh-Hant' → 'zh'; TEXT discarded
  return {
    rating: p.rating,
    userRatingsTotal: p.userRatingCount,
    primaryType: p.primaryType,
    venueType: p.primaryTypeDisplayName?.text || null,
    types: p.types ?? [],
    reviewLangs,
  };
}

function normalizePlace(p) {
  return {
    id: p.id,
    name: p.displayName?.text,
    address: p.formattedAddress,
    rating: p.rating,
    userRatingsTotal: p.userRatingCount,
    priceLevel: PRICE_LEVEL_MAP[p.priceLevel],
    businessStatus: p.businessStatus,
    googleMapsUrl: p.googleMapsUri,
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    editorialSummary: p.editorialSummary?.text,
    photos: p.photos ?? [],
  };
}

/**
 * Download a Places photo's actual image BYTES (following the media redirect) so
 * we can self-host it. Google's photoUri is short-lived; self-hosting gives a
 * permanent, fast, real photo of the venue. Returns bytes + attribution.
 */
export async function fetchPlacePhotoBytes(photo, { maxWidth = 1600 } = {}) {
  if (!KEY || !photo?.name) return null;
  const url = `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=${maxWidth}&key=${KEY}`;
  const res = await fetch(url); // 302 → image; fetch follows it and returns bytes
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) return null;
  const ct = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
  const attribution = photo.authorAttributions?.[0]?.displayName ?? 'Google Maps user';
  return {
    buf,
    contentType: ct,
    credit: `Photo: ${attribution} via Google Maps`,
    source: photo.authorAttributions?.[0]?.uri ?? 'https://maps.google.com',
  };
}

/**
 * Resolve a Places photo resource into a usable image object.
 * Photos come with author attribution we are required to display.
 */
export async function getPlacePhoto(photo, { maxWidth = 1600 } = {}) {
  if (!KEY || !photo?.name) return null;
  const url =
    `https://places.googleapis.com/v1/${photo.name}/media` +
    `?maxWidthPx=${maxWidth}&key=${KEY}&skipHttpRedirect=true`;

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();

  const attribution =
    photo.authorAttributions?.[0]?.displayName ?? 'Google Maps user';

  return {
    url: data.photoUri, // hosted by Google; safe to hotlink under Places terms
    credit: `Photo: ${attribution} via Google Maps`,
    license: 'google-places',
    source: photo.authorAttributions?.[0]?.uri ?? 'https://maps.google.com',
  };
}
