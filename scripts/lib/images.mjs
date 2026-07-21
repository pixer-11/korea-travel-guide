// Picks ONE legally-usable hero image for a post, in priority order:
//   1. A Google Places photo of the actual venue (best — it's the real place)
//   2. An Unsplash photo matching the query (openly licensed)
//   3. Our own placeholder SVG (always safe)
// Every returned image carries a license tag that guardrails will re-check.
import { getPlacePhoto } from './places.mjs';

const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;

const PLACEHOLDER = {
  url: '/images/placeholder-market.svg',
  credit: 'Placeholder image',
  license: 'placeholder',
  source: 'local',
};

export async function pickImage(place, fallbackQuery) {
  // 1. Real venue photo via Places.
  if (place?.photos?.length) {
    try {
      const img = await getPlacePhoto(place.photos[0]);
      if (img?.url) return img;
    } catch { /* fall through */ }
  }

  // 2. Unsplash (openly licensed) as a topical fallback.
  if (UNSPLASH_KEY && fallbackQuery) {
    try {
      const img = await searchUnsplash(fallbackQuery);
      if (img) return img;
    } catch { /* fall through */ }
  }

  // 3. Always-safe placeholder.
  return PLACEHOLDER;
}

// Grab up to `n` additional venue photos for an in-body gallery.
// Skips the first photo (already used as hero) to avoid duplication.
export async function pickGallery(place, n = 3) {
  const out = [];
  const photos = place?.photos ?? [];
  for (let i = 1; i < photos.length && out.length < n; i++) {
    try {
      const img = await getPlacePhoto(photos[i]);
      if (img?.url) out.push(img);
    } catch { /* skip */ }
  }
  return out;
}

const UTM = 'utm_source=korea_travel_guide&utm_medium=referral';

// Unsplash API guideline: trigger the download endpoint when a photo is
// actually used (required to keep API access). Fire-and-forget.
export function trackUnsplashDownload(location) {
  if (location && UNSPLASH_KEY) {
    fetch(location, { headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` } }).catch(() => {});
  }
}

// Returns up to `perPage` candidate images for a query (for de-duplication).
export async function unsplashCandidates(query, perPage = 30) {
  if (!UNSPLASH_KEY) return [];
  const url =
    `https://api.unsplash.com/search/photos?per_page=${perPage}&orientation=landscape` +
    `&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results ?? []).map((hit) => ({
    id: hit.id,
    url: `${hit.urls.raw}&w=1600&q=80&fm=jpg&fit=max`, // 1600px for Discover
    credit: `Photo by ${hit.user.name} on Unsplash`,
    license: 'unsplash',
    source: `${hit.user.links.html}?${UTM}`,
    downloadLocation: hit.links?.download_location,
  }));
}

// Single-image helper for the generator. Picks a RANDOM one of the top results
// (not always the first) to reduce duplicate photos across posts.
async function searchUnsplash(query) {
  const cands = await unsplashCandidates(query, 10);
  if (!cands.length) return null;
  const pick = cands[Math.floor(Math.random() * cands.length)];
  trackUnsplashDownload(pick.downloadLocation);
  return { url: pick.url, credit: pick.credit, license: pick.license, source: pick.source };
}
