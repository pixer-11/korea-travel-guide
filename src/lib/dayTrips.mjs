// Day-trip hubs (growth research B3, 2026-08-13): "Day trips from Bangkok" —
// existing guides recombined by DISTANCE, no new prose. Expedia's Unpack '26
// survey (24k travelers): 63% intend to visit a lesser-known town NEAR a
// marquee destination, and the site already holds the data to answer that —
// every post carries verified coordinates.
//
// Quality gates keep these out of thin-page territory (the exact failure the
// index-coverage audit exists to catch): an anchor city needs 6+ guides of its
// own, a neighbour counts only with 3+ guides inside 140km, and a hub is only
// born with 2+ such neighbours. Everything is computed from the posts
// collection at build time — a city that gains guides gains a hub by itself.
//
// Plain .mjs, with src/lib/dayTrips.ts as the typed door onto it, because
// astro.config.mjs needs the same hubs to date them in the sitemap: the page
// shows its NEIGHBOURS' guides, so "when did /day-trips/kyoto/ last change"
// is a question only this graph can answer, and a second copy of these gates
// in the config would be the fourth-copy mistake that left three region hubs
// dated at a URL no route builds (2026-09-07).
import { slugify } from '../../scripts/lib/slugify.mjs';

const NEAR_KM = 140;
const MIN_ANCHOR_POSTS = 6;
const MIN_NEIGHBOR_POSTS = 3;
const MIN_NEIGHBORS = 2;
const MAX_NEIGHBORS = 6;
const MAX_POSTS_PER_NEIGHBOR = 6;

/** @param {number[]} a */
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/** @param {{lat: number, lng: number}} a @param {{lat: number, lng: number}} b */
const distKm = (a, b) => {
  const R = 6371;
  /** @param {number} x */
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

// Attractions first on a day-trip list — same identity logic as the tiles.
/** @type {Record<string, number>} */
const CAT_RANK = { attraction: 0, 'hidden-gem': 1, trendy: 2, restaurant: 3, event: 9 };

/**
 * Every day-trip hub, with the neighbour guides each one displays.
 * Pure: same posts in, same hubs out. Call this from anywhere that must agree
 * with the routes about which hubs exist and what is on them.
 *
 * @param {{id: string, data: any}[]} posts
 * @returns {{city: string, slug: string, country: string, neighbors: {region: string, km: number, posts: {id: string, data: any}[], total: number}[]}[]}
 */
export function computeDayTrips(posts) {
  /** @type {Map<string, {id: string, data: any}[]>} */
  const byRegion = new Map();
  for (const p of posts) {
    const r = p.data.region;
    if (!r) continue;
    if (!byRegion.has(r)) byRegion.set(r, []);
    byRegion.get(r).push(p);
  }

  /** @type {Map<string, {country: string, lat: number, lng: number, count: number}>} */
  const meta = new Map();
  for (const [region, list] of byRegion) {
    const coords = list.filter((p) => p.data.place?.lat && p.data.place?.lng);
    if (!coords.length) continue;
    meta.set(region, {
      country: list[0].data.country ?? 'South Korea',
      lat: median(coords.map((p) => p.data.place.lat)),
      lng: median(coords.map((p) => p.data.place.lng)),
      count: list.length,
    });
  }

  const hubs = [];
  for (const [city, m] of meta) {
    if (m.count < MIN_ANCHOR_POSTS) continue;
    const neighbors = [];
    for (const [other, om] of meta) {
      if (other === city || om.country !== m.country) continue;
      if (om.count < MIN_NEIGHBOR_POSTS) continue;
      const km = distKm(m, om);
      if (km < 8 || km > NEAR_KM) continue; // <8km is the same urban area, not a trip
      const list = [...byRegion.get(other)]
        .sort((a, b) => (CAT_RANK[a.data.category] ?? 5) - (CAT_RANK[b.data.category] ?? 5) || String(b.data.pubDate).localeCompare(String(a.data.pubDate)))
        .slice(0, MAX_POSTS_PER_NEIGHBOR);
      neighbors.push({ region: other, km: Math.round(km), posts: list, total: om.count });
    }
    if (neighbors.length < MIN_NEIGHBORS) continue;
    neighbors.sort((a, b) => a.km - b.km);
    hubs.push({ city, slug: slugify(city), country: m.country, neighbors: neighbors.slice(0, MAX_NEIGHBORS) });
  }
  return hubs.sort((a, b) => a.slug.localeCompare(b.slug));
}

// ~265 regions × 5 languages of hub pages each call this during one build —
// memoized on the corpus size so the O(regions²) pass runs once, not 1,300
// times. Post count only ever changes between builds, never within one.
//
// The memo is why astro.config.mjs calls computeDayTrips() instead: its posts
// are a lean frontmatter DTO, and handing those back to a route that asked for
// the real collection would render a page out of stubs.
/** @type {{key: number, hubs: ReturnType<typeof computeDayTrips>} | null} */
let memo = null;

/** @param {{id: string, data: any}[]} posts */
export function buildDayTrips(posts) {
  if (memo && memo.key === posts.length) return memo.hubs;
  const hubs = computeDayTrips(posts);
  memo = { key: posts.length, hubs };
  return hubs;
}
