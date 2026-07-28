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

// Extract dwell time from OUR guides' prose. Recognizes multiple duration phrasings:
// - existing: "plan on/allow/budget/spend N hours|minutes"
// - "hour-long" / "an hour-long X" → 60min
// - "a couple of hours" → 120min
// - "a few hours" → 150min
// - "half-day" / "half a day" → 240min
// - "N-hour" (e.g. "2-hour walk", "three-hour visit") → N*60min
// - "N minutes" / "takes about N minutes" / "N-minute walk" → Nmin
// - "quick stop" / "a quick visit" → 30min
// Guard: ignore durations in sentences containing "full", "entire", "whole", "if you walk the", or "rather than"
// — these usually refer to alternatives, not the main visit. Precedence: first occurrence wins.
export function dwellMinutes(post) {
  const body = String(post.body || '');

  // Split into sentences (avoid splitting on decimal points like "1.5")
  // Match periods followed by space or end-of-string, or exclamation/question marks
  const sentences = body.split(/(?<!\d)[.!?]+(?=\s|$)/).map(s => s.trim()).filter(s => s.length > 0);
  const guardWords = ['full', 'entire', 'whole', 'if you walk the', 'rather than'];

  for (const sentence of sentences) {
    // Find earliest guard word position; only search BEFORE it
    let guardPos = Infinity;
    for (const guard of guardWords) {
      const pos = sentence.toLowerCase().indexOf(guard.toLowerCase());
      if (pos !== -1 && pos < guardPos) guardPos = pos;
    }
    const textToSearch = sentence.substring(0, guardPos);

    let mins = null;

    // Try each pattern in order of specificity (first match wins within the sentence)
    // Priority: existing range patterns first to avoid matching individual numbers in ranges

    // 0. Existing "plan on/allow/budget/spend N-M hours|minutes" (handles ranges, now with decimals like "1.5 to 2 hours")
    {
      const h = /(?:plan on|allow|budget|spend)\s+(?:about\s+|around\s+)?(\d+(?:\.\d+)?)\s*(?:(?:-|–|to)\s*)?(\d+(?:\.\d+)?)?\s*hours?/i.exec(textToSearch);
      const m = /(?:plan on|allow|budget|spend)\s+(?:about\s+|around\s+)?(\d+(?:\.\d+)?)\s*(?:(?:-|–|to)\s*)?(\d+(?:\.\d+)?)?\s*min/i.exec(textToSearch);
      if (h) {
        const first = Number(h[1]);
        const second = h[2] ? Number(h[2]) : first;
        mins = ((first + second) / 2) * 60;
      } else if (m) {
        const first = Number(m[1]);
        const second = m[2] ? Number(m[2]) : first;
        mins = (first + second) / 2;
      }
    }

    // 0b. "N-M minutes" or "N-M minute walk" patterns (e.g. "30-45 minutes", "a brisk 30-60 minute walk")
    if (!mins && /\ba?\s*\b(?:brisk|quick|short)?\s*(\d+)(?:\s*(?:-|–|to)\s*)?(\d+)?\s*-?minute/i.test(textToSearch)) {
      const m = /\b(?:brisk|quick|short)?\s*(\d+)(?:\s*(?:-|–|to)\s*)?(\d+)?\s*-?minutes?/i.exec(textToSearch);
      if (m) {
        const first = Number(m[1]);
        const second = m[2] ? Number(m[2]) : first;
        mins = (first + second) / 2;
      }
    }

    // If existing pattern didn't match, try new patterns
    if (!mins) {
      // 1. "quick stop" / "a quick visit"
      if (/\ba\s+quick\s+(?:stop|visit)/i.test(textToSearch)) {
        mins = 30;
      }
      // 2. "hour-long" / "an hour-long X"
      else if (/\b(?:an?\s+)?hour-long\b/i.test(textToSearch)) {
        mins = 60;
      }
      // 3. "a couple of hours"
      else if (/\ba\s+couple\s+of\s+hours\b/i.test(textToSearch)) {
        mins = 120;
      }
      // 4. "a few hours"
      else if (/\ba\s+few\s+hours\b/i.test(textToSearch)) {
        mins = 150;
      }
      // 5. "half-day" / "half a day" / "a half-day"
      else if (/(?:a\s+)?half(?:\s+a)?(?:\s+|-)?day\b/i.test(textToSearch)) {
        mins = 240;
      }
      // 6. "N-hour" with dash (e.g. "a 2-hour walk", "one-hour visit")
      else if (/\b(?:a\s+)?(?:one|two|three|four|\d+)-hours?\b/i.test(textToSearch)) {
        const m = /\b(?:a\s+)?(?:(one|two|three|four)|(\d+))-hours?\b/i.exec(textToSearch);
        if (m) {
          const numWord = m[1];
          const numDigit = m[2];
          const num = numDigit ? Number(numDigit) : { one: 1, two: 2, three: 3, four: 4 }[numWord.toLowerCase()];
          if (num) mins = num * 60;
        }
      }
      // 7. "N minutes" / "N-minute" / "takes about N minutes" (e.g. "30 minutes", "a 40-minute walk")
      else if (/\b(?:takes\s+about\s+|about\s+|a\s+)?(\d+)(?:-| )?min(?:utes?)?\b/i.test(textToSearch)) {
        const m = /\b(?:takes\s+about\s+|about\s+|a\s+)?(\d+)(?:-| )?min(?:utes?)?\b/i.exec(textToSearch);
        if (m) mins = Number(m[1]);
      }
    }

    // If found a valid duration in this sentence, return it (first match wins)
    if (mins != null && Number.isFinite(mins)) {
      return Math.max(30, Math.min(300, Math.round(mins)));
    }
  }

  // Fallback: category default
  const defaultDwell = DWELL_DEFAULT[post.data?.category] ?? 90;
  return Math.max(30, Math.min(300, Math.round(defaultDwell)));
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

  // R4: Check if destination is reached by water/ferry (even if <2km walking would suggest walk)
  // If the destination post mentions ferry/pier/river crossing, it's not a walking route
  const destText = (String(b.data?.title || '') + ' ' + String(b.body || '')).toLowerCase();
  const isWaterCrossing = /\bferry\b/.test(destText) || /\bpier\b/.test(destText) ||
                          /\bcross the river\b/.test(destText) || /\bboat\b/.test(destText);

  const transit = km > TRANSIT_KM || isWaterCrossing;
  return {
    km: Math.round(km * 10) / 10,
    // Only return minutes for walkable legs. Transit legs use TRANSIT_FLAT_MIN (~30 min) in budget;
    // we never estimate actual transit times as the page links Google Maps for real routing.
    // Water crossings especially: we cannot stand behind a walking estimate for something requiring a ferry.
    minutes: transit ? null : Math.round((km / WALK_KMH) * 60),
    transit
  };
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
  // Only transfer FROM clusters that can spare a post (length > 3, not ≥3) to avoid oscillation.
  const maxIterations = posts.length * days; // Safety cap to prevent infinite loops
  let iterations = 0;
  while (iterations < maxIterations) {
    iterations++;
    let minIdx = -1, minSize = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      if (clusters[i].length < minSize) {
        minSize = clusters[i].length;
        minIdx = i;
      }
    }

    if (minSize >= 3) break; // All clusters are large enough

    // Find the nearest post in other clusters that can spare it (donor.length > 3)
    let bestPost = null, bestSourceIdx = -1, bestDist = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      if (i === minIdx || clusters[i].length <= 3) continue; // Only consider clusters with > 3 posts
      for (const p of clusters[i]) {
        const d = haversineKm(seeds[minIdx].data.place.lat, seeds[minIdx].data.place.lng, p.data.place.lat, p.data.place.lng);
        if (d < bestDist) {
          bestDist = d;
          bestPost = p;
          bestSourceIdx = i;
        }
      }
    }

    if (!bestPost) break; // No posts can be transferred (no donor with > 3 posts)

    // Transfer the post
    clusters[bestSourceIdx].splice(clusters[bestSourceIdx].indexOf(bestPost), 1);
    clusters[minIdx].push(bestPost);
  }

  return clusters;
}

// Detect time-of-day preference from post's own text (R2).
// Returns 'evening', 'morning', or null if no strong signals.
export function preferredSlot(post) {
  const body = String(post.body || '');
  const title = String(post.data?.title || '');
  const text = (body + ' ' + title).toLowerCase();

  // Evening signals override morning
  if (/\bdinner\b/.test(text)) return 'evening';
  if (/\bevening\b/.test(text)) return 'evening';
  if (/\bnight(life|s)?\b/.test(text)) return 'evening';
  if (/\bafter\s+\d+\s*pm\b/.test(text)) return 'evening';
  if (/\bbar[\s-]club\b/.test(text)) return 'evening';
  if (/\brooftop\s+bar\b/.test(text)) return 'evening';

  // Morning signals
  if (/\bbreakfast\b/.test(text)) return 'morning';
  if (/\bbrunch\b/.test(text)) return 'morning';
  if (/\bmorning\b/.test(text)) return 'morning';

  return null;
}

// Order one day: quiet-morning anchor first, nearest-neighbor after, restaurant
// into the lunch slot with minimal detour (R1), respecting time-of-day preferences (R2).
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
  // Build stops with chronologically ordered slots: morning < lunch < afternoon < evening
  // This ensures the emitted day plan reads correctly top-to-bottom (not morning → afternoon → lunch → evening)
  const stops = [];

  // Morning must be a sight (not a restaurant) for proper day structure
  // If no sights exist (restaurant-only cluster), return empty stops to trigger guard in buildItinerary
  if (picked.length === 0) {
    return stops;
  }

  // Position 0: morning (first sight)
  stops.push({ post: picked[0], slot: 'morning' });

  // R1: Pick lunch restaurant with minimal detour (added distance to route)
  // Only schedule lunch if best restaurant adds < 2.5 km detour; otherwise skip
  const LUNCH_DETOUR_THRESHOLD = 2.5;
  let bestLunch = null, bestLunchDetour = Infinity;

  if (restaurants.length > 0 && picked.length >= 2) {
    for (const rest of restaurants) {
      // Detour cost: dist(morning → rest) + dist(rest → next) - dist(morning → next)
      const prevStop = stops[0].post;
      const nextStop = picked[1];
      const baseDist = haversineKm(prevStop.data.place.lat, prevStop.data.place.lng, nextStop.data.place.lat, nextStop.data.place.lng);
      const detourDist = haversineKm(prevStop.data.place.lat, prevStop.data.place.lng, rest.data.place.lat, rest.data.place.lng) +
                        haversineKm(rest.data.place.lat, rest.data.place.lng, nextStop.data.place.lat, nextStop.data.place.lng) - baseDist;

      if (detourDist < bestLunchDetour) {
        bestLunchDetour = detourDist;
        bestLunch = rest;
      }
    }

    // R2: Respect time-of-day preferences — only place if preference allows lunch
    if (bestLunch && bestLunchDetour < LUNCH_DETOUR_THRESHOLD) {
      const pref = preferredSlot(bestLunch);
      if (pref !== 'evening' && pref !== 'morning') {
        stops.push({ post: bestLunch, slot: 'lunch' });
        // Remove used restaurant
        const idx = restaurants.indexOf(bestLunch);
        if (idx !== -1) restaurants.splice(idx, 1);
      }
    }
  }

  // Position 2...n-1: afternoon (all sights except first and last)
  for (let i = 1; i < picked.length - 1; i++) {
    stops.push({ post: picked[i], slot: 'afternoon' });
  }

  // Position n-1: evening (last sight, if there are 2+ sights)
  if (picked.length > 1) {
    stops.push({ post: picked[picked.length - 1], slot: 'evening' });
  }

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
  // Ensure each cluster has at least 3 posts (rebalance may not achieve this with severely unbalanced input)
  for (let i = 0; i < clusters.length; i++) {
    if (clusters[i].length < 3) {
      return { ok: false, reason: `cluster ${i + 1} has only ${clusters[i].length} posts, need ≥3`, days: [] };
    }
  }
  // biggest clusters first → Day 1 is the headline area
  clusters.sort((a, b) => b.length - a.length);
  const out = [];
  for (let d = 0; d < days; d++) {
    const maxStops = gates.packed ? PACE.packed : PACE.normal;
    let stops = planDay(clusters[d], maxStops);
    // enforce the 10h budget by trimming the tail (never by shrinking dwell times)
    const total = (ss) => ss.reduce((m, s, i) => {
      const leg = i < ss.length - 1 ? walkLeg(s.post, ss[i + 1].post) : null;
      const legMinutes = leg ? (leg.transit ? TRANSIT_FLAT_MIN : (leg.minutes ?? 0)) : 0;
      return m + dwellMinutes(s.post) + legMinutes;
    }, 0);
    while (stops.length > PACE.relaxed && total(stops) > DAY_BUDGET_MIN) stops.pop();
    // Guard: no empty days
    if (stops.length === 0) {
      return { ok: false, reason: `day ${d + 1} has no stops (restaurant-only or under-provisioned cluster)`, days: [] };
    }
    // R3: Find best indoor rain swap from entire city (not just this day's cluster)
    const used = new Set(out.flatMap((x) => x.stops.map((s) => s.slug)).concat(stops.map((s) => s.post.id)));

    // Score posts as indoor-likely by category + keywords
    const isIndoorLikely = (p) => {
      const cat = p.data.category;
      if (cat === 'restaurant' || cat === 'trendy') return true;
      const text = (p.data.title + ' ' + (p.data.tags || []).join(' ')).toLowerCase();
      return /museum|gallery|mall|market|aquarium|arcade|spa|onsen|cafe|teahouse|department|store|hall|centre|center|library|bathhouse/i.test(text);
    };

    // Find unused indoor posts from city; pick nearest to day's geographic centre
    let rain = null;
    if (stops.length > 0) {
      const dayCenter = {
        lat: stops.reduce((s, stop) => s + stop.post.data.place.lat, 0) / stops.length,
        lng: stops.reduce((s, stop) => s + stop.post.data.place.lng, 0) / stops.length,
      };

      let bestDist = Infinity;
      for (const p of q) {
        if (!used.has(p.id) && isIndoorLikely(p)) {
          const d = haversineKm(dayCenter.lat, dayCenter.lng, p.data.place.lat, p.data.place.lng);
          if (d < bestDist) {
            bestDist = d;
            rain = p;
          }
        }
      }
    }
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
