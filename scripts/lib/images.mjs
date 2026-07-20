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

async function searchUnsplash(query) {
  const url =
    `https://api.unsplash.com/search/photos?per_page=1&orientation=landscape` +
    `&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const hit = data.results?.[0];
  if (!hit) return null;

  // Unsplash API guideline: trigger the download endpoint when a photo is
  // actually used (required to keep API access). Fire-and-forget.
  if (hit.links?.download_location) {
    fetch(hit.links.download_location, {
      headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` },
    }).catch(() => {});
  }

  // Request ~1600px wide (Google Discover wants large images) from the raw URL.
  const bigUrl = `${hit.urls.raw}&w=1600&q=80&fm=jpg&fit=max`;

  return {
    url: bigUrl,
    // Attribution links to the photographer's Unsplash profile with UTM,
    // per Unsplash's Attribution guideline.
    credit: `Photo by ${hit.user.name} on Unsplash`,
    license: 'unsplash',
    source: `${hit.user.links.html}?${UTM}`,
  };
}
