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
import { slugifyRegion } from './slug';

const NEAR_KM = 140;
const MIN_ANCHOR_POSTS = 6;
const MIN_NEIGHBOR_POSTS = 3;
const MIN_NEIGHBORS = 2;
const MAX_NEIGHBORS = 6;
const MAX_POSTS_PER_NEIGHBOR = 6;

type Post = { id: string; data: any };

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const distKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371, toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

// Attractions first on a day-trip list — same identity logic as the tiles.
const CAT_RANK: Record<string, number> = { attraction: 0, 'hidden-gem': 1, trendy: 2, restaurant: 3, event: 9 };

export interface DayTripNeighbor {
  region: string;
  km: number;
  posts: Post[];
  total: number;
}
export interface DayTripHub {
  city: string;
  slug: string;
  country: string;
  neighbors: DayTripNeighbor[];
}

// ~265 regions × 5 languages of hub pages each call this during one build —
// memoized on the corpus size so the O(regions²) pass runs once, not 1,300
// times. Post count only ever changes between builds, never within one.
let memo: { key: number; hubs: DayTripHub[] } | null = null;

export function buildDayTrips(posts: Post[]): DayTripHub[] {
  if (memo && memo.key === posts.length) return memo.hubs;
  const hubs = compute(posts);
  memo = { key: posts.length, hubs };
  return hubs;
}

function compute(posts: Post[]): DayTripHub[] {
  const byRegion = new Map<string, Post[]>();
  for (const p of posts) {
    const r = p.data.region;
    if (!r) continue;
    if (!byRegion.has(r)) byRegion.set(r, []);
    byRegion.get(r)!.push(p);
  }

  const meta = new Map<string, { country: string; lat: number; lng: number; count: number }>();
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

  const hubs: DayTripHub[] = [];
  for (const [city, m] of meta) {
    if (m.count < MIN_ANCHOR_POSTS) continue;
    const neighbors: DayTripNeighbor[] = [];
    for (const [other, om] of meta) {
      if (other === city || om.country !== m.country) continue;
      if (om.count < MIN_NEIGHBOR_POSTS) continue;
      const km = distKm(m, om);
      if (km < 8 || km > NEAR_KM) continue; // <8km is the same urban area, not a trip
      const list = [...byRegion.get(other)!]
        .sort((a, b) => (CAT_RANK[a.data.category] ?? 5) - (CAT_RANK[b.data.category] ?? 5) || String(b.data.pubDate).localeCompare(String(a.data.pubDate)))
        .slice(0, MAX_POSTS_PER_NEIGHBOR);
      neighbors.push({ region: other, km: Math.round(km), posts: list, total: om.count });
    }
    if (neighbors.length < MIN_NEIGHBORS) continue;
    neighbors.sort((a, b) => a.km - b.km);
    hubs.push({ city, slug: slugifyRegion(city), country: m.country, neighbors: neighbors.slice(0, MAX_NEIGHBORS) });
  }
  return hubs.sort((a, b) => a.slug.localeCompare(b.slug));
}
