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
export async function getPlaceById(placeId) {
  if (!KEY || !placeId) return null;
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': FIELD_MASK.replaceAll('places.', ''),
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) return null;
  return normalizePlace(await res.json());
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
