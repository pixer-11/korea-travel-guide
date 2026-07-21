// Picks ONE legally-usable hero image for a post, in priority order:
//   1. A Google Places photo of the actual venue (best — it's the real place)
//   2. An Unsplash photo matching the query (openly licensed)
//   3. Our own placeholder SVG (always safe)
// Every returned image carries a license tag that guardrails will re-check.
import { getPlacePhoto } from './places.mjs';
import { commonsBest, keyToken } from './commons.mjs';

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

// ── Accurate-first hero resolver ─────────────────────────────
// Priority is ACCURACY, not just "a nice photo":
//   1. Wikimedia Commons by the real venue name  → actual photo of THIS place
//   2. Google Places photo of the venue          → actual photo (may be short-lived)
//   3. Wikimedia Commons by topic + region       → right place & country
//   4. Unsplash, strictly constrained to region + "South Korea", BEST (not random)
//   5. Placeholder
// `used` is an optional Set of URLs already taken by other posts (de-dupe).
export async function resolveHero({ namedVenue, region, topic, place, used, allowUnsplash = true } = {}) {
  const reg = region || '';

  if (namedVenue) {
    const anchor = keyToken(namedVenue);
    const byName =
      (await commonsBest(`${namedVenue} ${reg}`, { mustInclude: [anchor], used })) ||
      (await commonsBest(namedVenue, { mustInclude: [anchor], used }));
    if (byName) return mark(byName, used);

    // Google Places photos ARE the actual venue, but the returned photoUri
    // EXPIRES within hours — unusable on a static site unless self-hosted.
    // Off by default; the Wikimedia/Unsplash URLs below are permanent.
    if (process.env.USE_PLACES_PHOTO === '1' && place?.photos?.length) {
      try {
        const img = await getPlacePhoto(place.photos[0]);
        if (img?.url && (!used || !used.has(img.url))) return mark(img, used);
      } catch { /* fall through */ }
    }
  }

  // The topic itself may be a place name (e.g. "Nami Island", "Abai Village",
  // "Aewol"). Try Commons by topic-as-name — but skip generic topic words so
  // "local restaurant" can't match some random file containing "local".
  if (!namedVenue && topic) {
    const anchor = keyToken(topic);
    const GENERIC = new Set([
      'local', 'trendy', 'hidden', 'street', 'best', 'top', 'cafe', 'cafes',
      'restaurant', 'food', 'popular', 'famous', 'black', 'sight', 'sightseeing',
      'nature', 'history', 'coffee', 'seafood',
    ]);
    if (anchor && anchor.length > 3 && !GENERIC.has(anchor)) {
      const byTopicName =
        (await commonsBest(`${topic} ${reg}`, { mustInclude: [anchor], used })) ||
        (await commonsBest(topic, { mustInclude: [anchor], used }));
      if (byTopicName) return mark(byTopicName, used);
    }
  }

  const topicQ = [topic, reg, 'South Korea'].filter(Boolean).join(' ');
  const byTopic = await commonsBest(topicQ, { mustInclude: [reg].filter(Boolean), used });
  if (byTopic) return mark(byTopic, used);

  if (allowUnsplash) {
    // Specific → region-level → country-level. Over-specific queries often
    // return nothing; broadening guarantees a Korea-accurate photo, never a
    // wrong-country one, and never a blank placeholder.
    const u =
      (await unsplashStrict([reg, 'South Korea', topic].filter(Boolean).join(' '), used)) ||
      (await unsplashStrict([reg, 'South Korea'].filter(Boolean).join(' '), used)) ||
      (await unsplashStrict('South Korea travel landscape', used));
    if (u) return mark(u, used);
  }

  return PLACEHOLDER;
}

function mark(img, used) {
  if (used && img?.url) used.add(img.url);
  if (!img) return img;
  // Return ONLY the fields the post schema stores — Commons candidates carry
  // internal scoring fields (index, w, h, featured…) that must not leak into
  // frontmatter.
  return { url: img.url, credit: img.credit, license: img.license, source: img.source };
}

// Unsplash, deterministic BEST match (top of the ranked candidates), Korea-scoped.
// Never random — random top-10 picks are what produced wrong-country photos.
async function unsplashStrict(query, used) {
  const cands = await unsplashCandidates(query, 12);
  const pick = cands.find((c) => !used || !used.has(c.url)) || cands[0];
  if (!pick) return null;
  trackUnsplashDownload(pick.downloadLocation);
  return { url: pick.url, credit: pick.credit, license: pick.license, source: pick.source };
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
