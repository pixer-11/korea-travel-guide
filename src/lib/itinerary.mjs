// Itinerary solver — PURE functions only. No IO, no AI. Every number shown to a
// reader (walk minutes, dwell, closed days) is computed here from verified post
// data, never model-generated. Shared by scripts/build-itineraries.mjs (assembly),
// scripts/validate-itineraries.mjs (gate) and the Astro pages (render + filter).

const DWELL_DEFAULT = { attraction: 120, restaurant: 60, 'hidden-gem': 90, trendy: 90, essentials: 60 };
const WALK_KMH = 4.5;            // conservative city walking speed
const TRANSIT_KM = 2;            // beyond this we say "take the subway/taxi", never a walk estimate
const TRANSIT_FLAT_MIN = 30;     // budget figure for a transit leg (not shown as a promise)
const DAY_BUDGET_MIN = 600;      // 10h hard cap, spec §2
const PACE = { relaxed: 3, normal: 4, packed: 5 };

export function qualifyingPosts(posts) {
  return posts.filter((p) => {
    const d = p.data;
    if (d.draft || d.category === 'event') return false;
    const pl = d.place || {};
    if (typeof pl.lat !== 'number' || typeof pl.lng !== 'number') return false;
    if (String(pl.businessStatus || '').startsWith('CLOSED')) return false;
    return true;
  });
}

export function gateFor(n) {
  return { threeDay: n >= 12, packed: n >= 15, fiveDay: n >= 24 };
}

// Google Places weekdayDescriptions → days that are fully closed.
export function closedDaysOf(openingHours) {
  if (!Array.isArray(openingHours)) return [];
  const out = [];
  for (const line of openingHours) {
    const m = /^(\w+):\s*(.+)$/.exec(String(line).trim());
    if (m && /^closed$/i.test(m[2].trim())) out.push(m[1]);
  }
  return out;
}

// "plan on 2-3 hours" / "allow 90 minutes" in OUR vetted prose → minutes.
// Take the range midpoint; clamp to sane bounds; else category default.
export function dwellMinutes(post) {
  const body = String(post.body || '');
  const h = /(?:plan on|allow|budget|spend)\s+(?:about\s+|around\s+)?(\d+)(?:\s*(?:-|–|to)\s*(\d+))?\s*hours?/i.exec(body);
  const m = /(?:plan on|allow|budget|spend)\s+(?:about\s+|around\s+)?(\d+)(?:\s*(?:-|–|to)\s*(\d+))?\s*min/i.exec(body);
  let mins = null;
  if (h) mins = ((Number(h[1]) + Number(h[2] || h[1])) / 2) * 60;
  else if (m) mins = (Number(m[1]) + Number(m[2] || m[1])) / 2;
  if (mins == null || !Number.isFinite(mins)) mins = DWELL_DEFAULT[post.data?.category] ?? 90;
  return Math.max(30, Math.min(300, Math.round(mins)));
}

const rad = (x) => (x * Math.PI) / 180;
export function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function walkLeg(a, b) {
  const A = a.data.place, B = b.data.place;
  const km = haversineKm(A.lat, A.lng, B.lat, B.lng) * 1.3; // 1.3 = street-grid detour factor
  const transit = km > TRANSIT_KM;
  return { km: Math.round(km * 10) / 10, minutes: Math.round((km / WALK_KMH) * 60), transit };
}

// Greedy geographic clustering: seed each day with the farthest-apart anchors,
// then assign every post to the nearest seed. Deterministic (sorted input).
function clusterByDay(posts, days) {
  const sorted = [...posts].sort((a, b) => a.id.localeCompare(b.id));
  const seeds = [sorted[0]];
  while (seeds.length < days) {
    let best = null, bestD = -1;
    for (const p of sorted) {
      if (seeds.includes(p)) continue;
      const d = Math.min(...seeds.map((s) => haversineKm(s.data.place.lat, s.data.place.lng, p.data.place.lat, p.data.place.lng)));
      if (d > bestD) { bestD = d; best = p; }
    }
    if (!best) break;
    seeds.push(best);
  }
  const clusters = seeds.map(() => []);
  for (const p of sorted) {
    let ci = 0, cd = Infinity;
    seeds.forEach((s, i) => {
      const d = haversineKm(s.data.place.lat, s.data.place.lng, p.data.place.lat, p.data.place.lng);
      if (d < cd) { cd = d; ci = i; }
    });
    clusters[ci].push(p);
  }

  // Rebalance: ensure each cluster has at least 3 posts by transferring from larger clusters
  while (true) {
    let minIdx = -1, minSize = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      if (clusters[i].length < minSize) {
        minSize = clusters[i].length;
        minIdx = i;
      }
    }

    if (minSize >= 3) break; // All clusters are large enough

    // Find the nearest post in other clusters
    let bestPost = null, bestSourceIdx = -1, bestDist = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      if (i === minIdx) continue;
      for (const p of clusters[i]) {
        const d = haversineKm(seeds[minIdx].data.place.lat, seeds[minIdx].data.place.lng, p.data.place.lat, p.data.place.lng);
        if (d < bestDist) {
          bestDist = d;
          bestPost = p;
          bestSourceIdx = i;
        }
      }
    }

    if (!bestPost) break; // No posts to transfer

    // Transfer the post
    clusters[bestSourceIdx].splice(clusters[bestSourceIdx].indexOf(bestPost), 1);
    clusters[minIdx].push(bestPost);
  }

  return clusters;
}

// Order one day: quiet-morning anchor first, nearest-neighbor after, restaurant
// into the lunch slot, latest-open venue into the evening slot (noctourism).
function planDay(cluster, stopsWanted) {
  const restaurants = cluster.filter((p) => p.data.category === 'restaurant');
  const sights = cluster.filter((p) => p.data.category !== 'restaurant');
  const quietMorning = (p) => (p.data.place?.busyness?.weekdayQuiet || []).some((h) => h >= 8 && h <= 11);
  sights.sort((a, b) => Number(quietMorning(b)) - Number(quietMorning(a)) || (b.data.place?.userRatingsTotal || 0) - (a.data.place?.userRatingsTotal || 0));
  const picked = [];
  let cur = sights[0];
  const pool = new Set(sights.slice(1));
  while (cur && picked.length < stopsWanted - (restaurants.length ? 1 : 0)) {
    picked.push(cur);
    let next = null, nd = Infinity;
    for (const p of pool) {
      const d = haversineKm(cur.data.place.lat, cur.data.place.lng, p.data.place.lat, p.data.place.lng);
      if (d < nd) { nd = d; next = p; }
    }
    if (next) pool.delete(next);
    cur = next;
  }
  // lunch after the first 1-2 stops; evening = last stop
  const stops = [];
  picked.forEach((p, i) => {
    if (i === Math.min(2, picked.length - 1) && restaurants[0]) {
      stops.push({ post: restaurants.shift(), slot: 'lunch' });
    }
    stops.push({ post: p, slot: i === 0 ? 'morning' : 'afternoon' });
  });
  if (stops.length > 1) stops[stops.length - 1].slot = 'evening';
  return stops;
}

export function buildItinerary(posts, { days }) {
  const q = qualifyingPosts(posts);
  // Early guard: ensure minimum viable posts for the requested day count
  if (q.length < 3 * days) {
    return { ok: false, reason: `only ${q.length} qualifying posts for ${days}-day (minimum ${3 * days} needed)`, days: [] };
  }
  const gates = gateFor(q.length);
  if ((days === 3 && !gates.threeDay) || (days === 5 && !gates.fiveDay)) {
    return { ok: false, reason: `only ${q.length} qualifying posts for ${days}-day`, days: [] };
  }
  const clusters = clusterByDay(q, days).filter((c) => c.length);
  if (clusters.length < days) return { ok: false, reason: 'not enough geographic spread', days: [] };
  // biggest clusters first → Day 1 is the headline area
  clusters.sort((a, b) => b.length - a.length);
  const out = [];
  for (let d = 0; d < days; d++) {
    const maxStops = gates.packed ? PACE.packed : PACE.normal;
    let stops = planDay(clusters[d], maxStops);
    // enforce the 10h budget by trimming the tail (never by shrinking dwell times)
    const total = (ss) => ss.reduce((m, s, i) => {
      const leg = i < ss.length - 1 ? walkLeg(s.post, ss[i + 1].post) : null;
      return m + dwellMinutes(s.post) + (leg ? (leg.transit ? TRANSIT_FLAT_MIN : leg.minutes) : 0);
    }, 0);
    while (stops.length > PACE.relaxed && total(stops) > DAY_BUDGET_MIN) stops.pop();
    // Guard: no empty days
    if (stops.length === 0) {
      return { ok: false, reason: `day ${d + 1} has no stops (restaurant-only or under-provisioned cluster)`, days: [] };
    }
    // indoor rain swap: an unused venue in this cluster whose category suggests indoor
    const used = new Set(out.flatMap((x) => x.stops.map((s) => s.slug)).concat(stops.map((s) => s.post.id)));
    const rain = clusters[d].find((p) => !used.has(p.id) && /museum|market|mall|gallery|aquarium|tower|temple hall/i.test(p.data.title + ' ' + (p.data.tags || []).join(' ')));
    out.push({
      stops: stops.map((s, i) => ({
        slug: s.post.id,
        slot: s.slot,
        dwellMin: dwellMinutes(s.post),
        walkToNext: i < stops.length - 1 ? walkLeg(s.post, stops[i + 1].post) : null,
      })),
      rainSwapSlug: rain?.id ?? null,
    });
  }
  return { ok: true, days: out };
}
