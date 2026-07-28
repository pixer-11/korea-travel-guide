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
const MIN_STOPS = 3;             // plan bound: a day is never thinner than three stops
const LUNCH_DETOUR_KM = 2.5;     // a lunch stop may not bend the day's route by more than this

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

const byId = (a, b) => a.id.localeCompare(b.id);
const latOf = (p) => p.data.place.lat;
const lngOf = (p) => p.data.place.lng;
const kmBetween = (a, b) => haversineKm(latOf(a), lngOf(a), latOf(b), lngOf(b));
const kmFromPoint = (c, p) => haversineKm(c.lat, c.lng, latOf(p), lngOf(p));
const centroidOf = (list) => ({
  lat: list.reduce((s, p) => s + latOf(p), 0) / list.length,
  lng: list.reduce((s, p) => s + lngOf(p), 0) / list.length,
});

// Greedy geographic clustering: seed each day with the farthest-apart anchors,
// then assign every post to the nearest seed. Deterministic (sorted input).
// NOTE: no rebalancing here — an uneven or even empty cluster is fine, because
// buildItinerary repairs thin days afterwards by moving posts between days
// (see repairDay). The old in-cluster rebalance loop could oscillate forever.
function clusterByDay(posts, days) {
  const sorted = [...posts].sort(byId);
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
  return { clusters, seeds };
}

// Detect a HARD time-of-day lock from the post's own text (R2).
// Returns 'evening', 'morning', or null.
//
// This is deliberately narrow. Our guides constantly say things like "go early
// morning to beat the crowds" or "evenings after dinner are calmest" — those are
// crowd-avoidance tips about an all-day venue, NOT opening-hours locks. Treating
// them as locks made almost every post evening-locked and left no feasible day
// plan at all. A lock only fires on wording that describes the venue's own
// service window:
//   * unambiguous, any category: "evening dinner service", "dinner-only",
//     "dinner service", "opens for dinner", "bar-club", "breakfast-and-brunch",
//     "breakfast only" / "brunch only"
//   * eat-and-drink venues (restaurant / trendy) only, where a whole-evening
//     phrasing really does mean the seating is at night: "a full evening",
//     "a relaxed evening", "after 9pm", "rooftop bar"
const HARD_EVENING = /evening dinner service|\bdinner[\s-]only\b|\bdinner service\b|\bopens?\s+(?:only\s+)?(?:for|at)\s+dinner\b|\bbar[\s-]club\b/;
const HARD_MORNING = /\bbreakfast[\s-]and[\s-]brunch\b|\b(?:breakfast|brunch)[\s-]only\b|\bonly\s+(?:serves?|opens?\s+for)\s+(?:breakfast|brunch)\b/;
const SERVICE_EVENING = /\b(?:a\s+)?(?:full|relaxed|whole|entire|long)\s+evening\b|\bafter\s+\d{1,2}\s*(?:pm|p\.m\.)|\brooftop\s+bar\b/;
const EAT_DRINK = new Set(['restaurant', 'trendy']);

// A guide's prose is not only its body: description, quickAnswer and the FAQ answers
// carry just as much of the venue's own voice. bangkok-somsak's "bar-club energy,
// especially after 9pm" is in an FAQ answer, so a body-only read missed the lock and
// the validator caught Somsak sitting in an afternoon slot.
function postProse(post) {
  const d = post.data || {};
  const parts = [String(post.body || ''), String(d.title || ''), String(d.description || ''), String(d.quickAnswer || '')];
  if (Array.isArray(d.tags)) parts.push(d.tags.join(' '));
  if (Array.isArray(d.faq)) for (const f of d.faq) parts.push(String(f?.q || ''), String(f?.a || ''));
  return parts.join(' ').toLowerCase();
}

export function preferredSlot(post) {
  const text = postProse(post);

  if (HARD_EVENING.test(text)) return 'evening';
  if (HARD_MORNING.test(text)) return 'morning';
  if (EAT_DRINK.has(post.data?.category) && SERVICE_EVENING.test(text)) return 'evening';
  return null;
}

// Order one day. A day is: morning sight → (optional lunch restaurant) → afternoon
// sights → evening sight, always in that chronological order, 3–5 stops, one area,
// walked nearest-neighbour. Slot locks from preferredSlot() are honoured by EXCLUDING
// a venue from the day rather than mis-slotting it; buildItinerary then backfills.
//
// Pure and total: it never throws and never depends on anything outside `dayPosts`.
// It may legitimately return fewer than MIN_STOPS stops — that is the signal to
// buildItinerary that this day needs more posts moved into it.
const quietMorning = (p) => (p.data.place?.busyness?.weekdayQuiet || []).some((h) => h >= 8 && h <= 11);

// Lower sorts first: a venue that is quiet mid-morning (or reads as a morning venue)
// makes the better day-opener; popularity then id break the remaining ties.
function anchorRank(p) {
  return (quietMorning(p) ? 0 : 2) + (preferredSlot(p) === 'morning' ? -1 : 0);
}

function nearestNeighbourChain(pool) {
  if (!pool.length) return [];
  const rest = [...pool].sort((a, b) =>
    anchorRank(a) - anchorRank(b) ||
    (b.data.place?.userRatingsTotal || 0) - (a.data.place?.userRatingsTotal || 0) ||
    byId(a, b));
  const chain = [rest.shift()];
  while (rest.length) {
    const cur = chain[chain.length - 1];
    let bi = 0, bd = Infinity;
    for (let i = 0; i < rest.length; i++) {
      const d = kmBetween(cur, rest[i]);
      if (d < bd) { bd = d; bi = i; }
    }
    chain.push(rest.splice(bi, 1)[0]);
  }
  return chain;
}

// dist(prev,rest) + dist(rest,next) − dist(prev,next): how far the lunch stop bends the route.
function lunchDetourKm(prev, rest, next) {
  return kmBetween(prev, rest) + kmBetween(rest, next) - kmBetween(prev, next);
}

function dayTotalMinutes(stops) {
  let total = 0;
  for (let i = 0; i < stops.length; i++) {
    total += dwellMinutes(stops[i].post);
    if (i < stops.length - 1) {
      const leg = walkLeg(stops[i].post, stops[i + 1].post);
      total += leg.transit ? TRANSIT_FLAT_MIN : (leg.minutes ?? 0);
    }
  }
  return total;
}

function layoutDay(dayPosts, maxStops) {
  const sights = dayPosts.filter((p) => p.data.category !== 'restaurant');
  // A restaurant only ever takes the lunch slot, so an evening-locked one is never eligible.
  const lunchable = dayPosts.filter((p) => p.data.category === 'restaurant' && preferredSlot(p) !== 'evening');
  if (!sights.length) return [];

  const eveningLocked = sights.filter((p) => preferredSlot(p) === 'evening');
  const openSights = sights.filter((p) => preferredSlot(p) !== 'evening');

  // Every sight here is evening-locked: only one of them can honestly be scheduled.
  if (!openSights.length) {
    return [{ post: [...eveningLocked].sort(byId)[0], slot: 'evening' }];
  }

  const chain = nearestNeighbourChain(openSights);
  let head;            // morning + afternoon stops, in walking order
  let eveningPost = null;

  if (eveningLocked.length) {
    // An evening-locked venue owns the evening slot; the rest of them are excluded
    // from this day entirely (they stay available for another day or a rain swap).
    head = chain.slice(0, Math.max(1, maxStops - 1));
    const tail = head[head.length - 1];
    eveningPost = [...eveningLocked].sort((a, b) => kmBetween(tail, a) - kmBetween(tail, b) || byId(a, b))[0];
  } else if (chain.length >= 2) {
    const take = chain.slice(0, maxStops);
    let lastIdx = take.length - 1;
    if (preferredSlot(take[lastIdx]) === 'morning') {
      // A breakfast/brunch venue must never close the day: swap it inward if we can,
      // otherwise this day simply has no evening stop.
      let swap = -1;
      for (let i = lastIdx - 1; i >= 1; i--) { if (preferredSlot(take[i]) !== 'morning') { swap = i; break; } }
      if (swap > 0) { const t = take[swap]; take[swap] = take[lastIdx]; take[lastIdx] = t; }
      else lastIdx = -1;
    }
    if (lastIdx >= 0) { eveningPost = take[lastIdx]; head = take.slice(0, lastIdx); }
    else head = take;
  } else {
    head = chain.slice(0, maxStops);
  }
  if (!head.length) head = [chain[0]];

  // R1: lunch only if the detour is genuinely small. Otherwise it is skipped, and the
  // freed capacity goes back to sights (that is what `room` below does).
  const afternoonPool = head.slice(1);
  const nextAfterMorning = afternoonPool[0] ?? eveningPost;
  let lunchPost = null;
  if (lunchable.length && nextAfterMorning) {
    let best = null, bestDetour = Infinity;
    for (const r of [...lunchable].sort(byId)) {
      const d = lunchDetourKm(head[0], r, nextAfterMorning);
      if (d < bestDetour) { bestDetour = d; best = r; }
    }
    if (best && bestDetour <= LUNCH_DETOUR_KM) lunchPost = best;
  }

  const room = maxStops - 1 - (lunchPost ? 1 : 0) - (eveningPost ? 1 : 0);
  const stops = [{ post: head[0], slot: 'morning' }];
  if (lunchPost) stops.push({ post: lunchPost, slot: 'lunch' });
  for (const p of afternoonPool.slice(0, Math.max(0, room))) stops.push({ post: p, slot: 'afternoon' });
  if (eveningPost) stops.push({ post: eveningPost, slot: 'evening' });

  // Enforce the 10h budget by dropping stops, never by shrinking a dwell time.
  while (stops.length > 1 && dayTotalMinutes(stops) > DAY_BUDGET_MIN) {
    let idx = -1;
    for (let i = stops.length - 1; i >= 1; i--) { if (stops[i].slot === 'afternoon') { idx = i; break; } }
    if (idx === -1) idx = stops.findIndex((s) => s.slot === 'evening');
    if (idx === -1) idx = stops.findIndex((s) => s.slot === 'lunch');
    if (idx === -1) break;
    stops.splice(idx, 1);
  }
  return stops;
}

// R3: is this post a place you can actually shelter in?
//
// The verdict comes from the TITLE and TAGS, not the body. Our post bodies all carry
// boilerplate ("photo gallery", nearby-venue name-drops), so body keyword matching
// declared an open-air photo spot indoor because the prose happened to mention a
// museum down the road. Title + tags name the venue itself.
//   * an open-air noun in the title ("… Park", "… Weekend Market") vetoes, unless an
//     enclosed noun is also there ("Covered Market", "Museum")
//   * an enclosed noun in the title settles it
//   * otherwise, an eat-and-drink venue is an enclosed room by definition — unless its
//     own prose says it is a street-food stall, a night market, an alley or a rooftop
const OPEN_AIR_NOUN = /street food|open[\s-]?air|\bmarkets?\b|\bpark\b|\bgarden\b|\bpier\b|\bbeach\b|\bplaza\b|\bsquare\b|\bvillage\b|\balley\b|\bstreets?\b|\boutdoors?\b/;
const ENCLOSED_NOUN = /museum|gallery|\bmall\b|department store|aquarium|arcade|\bspa\b|onsen|bathhouse|library|\bhall\b|\bcentre\b|\bcenter\b|covered market|cinema|theatre|theater/;
const OPEN_AIR_PROSE = /street food|night market|weekend market|open[\s-]?air|\boutdoors?\b|\balley\b|rooftop bar|open to the sky|no shelter/;
// "a chef-driven concept restaurant rather than casual street food" is prose ABOUT
// street food, not a street-food stall. A contrast marker in the same sentence
// disqualifies the open-air signal.
const CONTRAST = /rather than|instead of|as opposed to|\bversus\b|\bvs\.?\b|\bunlike\b/;

function readsOpenAir(body) {
  for (const sentence of body.split(/(?<!\d)[.!?]+(?=\s|$)/)) {
    if (OPEN_AIR_PROSE.test(sentence) && !CONTRAST.test(sentence)) return true;
  }
  return false;
}

function isGenuinelyIndoor(p) {
  const head = (String(p.data.title || '') + ' ' + (p.data.tags || []).join(' ')).toLowerCase();
  const prose = postProse(p);
  if (OPEN_AIR_NOUN.test(head) && !ENCLOSED_NOUN.test(head)) return false;
  if (ENCLOSED_NOUN.test(head)) return !readsOpenAir(prose);
  if (EAT_DRINK.has(p.data.category)) return !readsOpenAir(prose);
  return false;
}

// Where a day "is", for backfill and rain-swap distance. Falls back to the posts
// merely assigned to the day, then to the day's cluster seed, so it is always defined.
function dayCentre(stops, assigned, seed) {
  if (stops.length) return centroidOf(stops.map((s) => s.post));
  if (assigned.length) return centroidOf(assigned);
  return { lat: latOf(seed), lng: lngOf(seed) };
}

// THE BACKFILL STEP. A day came out under MIN_STOPS — because lunch was skipped, a
// slot lock excluded a venue, the budget trimmed a stop, or its cluster was simply
// thin. Pull in the nearest post that actually makes the day longer, taking either a
// post no day is using or a stop from a day that can spare one (stays ≥ MIN_STOPS).
// Returns true if it moved something. Never breaks another day.
function repairDay(target, assign, layouts, seeds, maxStops) {
  const centre = dayCentre(layouts[target], assign[target], seeds[target]);
  const candidates = [];
  for (let src = 0; src < assign.length; src++) {
    if (src === target) continue;
    const srcStops = new Set(layouts[src].map((s) => s.post.id));
    for (const p of assign[src]) {
      // A post its own day is not using is free. A post that IS a stop can only move
      // if its day would still hold MIN_STOPS without it.
      if (srcStops.has(p.id) && layouts[src].length <= MIN_STOPS) continue;
      candidates.push({ post: p, src });
    }
  }
  candidates.sort((a, b) => kmFromPoint(centre, a.post) - kmFromPoint(centre, b.post) || byId(a.post, b.post));

  for (const c of candidates) {
    const nextTarget = layoutDay([...assign[target], c.post], maxStops);
    if (nextTarget.length <= layouts[target].length) continue;   // did not help — try the next one
    const srcRemaining = assign[c.src].filter((p) => p !== c.post);
    const nextSrc = layoutDay(srcRemaining, maxStops);
    if (nextSrc.length < Math.min(MIN_STOPS, layouts[c.src].length)) continue; // would break the donor
    assign[c.src] = srcRemaining;
    assign[target] = [...assign[target], c.post];
    layouts[c.src] = nextSrc;
    layouts[target] = nextTarget;
    return true;
  }
  return false;
}

export function buildItinerary(posts, { days }) {
  const q = qualifyingPosts(posts);
  if (q.length < MIN_STOPS * days) {
    return { ok: false, reason: `only ${q.length} qualifying posts for ${days}-day (minimum ${MIN_STOPS * days} needed)`, days: [] };
  }
  const gates = gateFor(q.length);
  if ((days === 3 && !gates.threeDay) || (days === 5 && !gates.fiveDay)) {
    return { ok: false, reason: `only ${q.length} qualifying posts for ${days}-day`, days: [] };
  }
  const maxStops = gates.packed ? PACE.packed : PACE.normal;

  // Biggest cluster first → Day 1 is the headline area. Index breaks size ties.
  const { clusters, seeds } = clusterByDay(q, days);
  const order = clusters.map((_, i) => i).sort((a, b) => clusters[b].length - clusters[a].length || a - b);
  const assign = order.map((i) => [...clusters[i]]);
  const daySeeds = order.map((i) => seeds[i]);
  const layouts = assign.map((a) => layoutDay(a, maxStops));

  // Each successful repair strictly increases Σ min(stops, MIN_STOPS), which is bounded
  // by MIN_STOPS * days — so this terminates; the cap is belt-and-braces.
  for (let iter = 0; iter <= MIN_STOPS * days; iter++) {
    const short = layouts.findIndex((s) => s.length < MIN_STOPS);
    if (short === -1) break;
    if (!repairDay(short, assign, layouts, daySeeds, maxStops)) {
      return {
        ok: false,
        days: [],
        reason: `day ${short + 1} has only ${layouts[short].length} stops and no unused sight can be added within the ${DAY_BUDGET_MIN}-minute day budget (restaurant-only or under-provisioned area)`,
      };
    }
  }
  for (let d = 0; d < days; d++) {
    if (layouts[d].length < MIN_STOPS) {
      return { ok: false, days: [], reason: `day ${d + 1} has only ${layouts[d].length} stops, need ≥${MIN_STOPS} per plan bounds` };
    }
  }

  // A day of four stops with no wet-weather option is worth less than a day of three
  // that has one. Where a day is over the minimum and one of its own later stops is a
  // genuinely indoor venue, hand that venue back to the rain-swap pool. The day stays
  // ≥ MIN_STOPS and stays chronological (we only ever remove, never reorder).
  // Give up an afternoon first and the evening stop only as a fallback. The lunch stop
  // is never given up — a day plan without a meal in it is worse than a day plan
  // without a wet-weather option.
  for (const layout of layouts) {
    if (layout.length <= MIN_STOPS) continue;
    let release = -1;
    for (const slot of ['afternoon', 'evening']) {
      for (let i = layout.length - 1; i >= 1; i--) {
        if (layout[i].slot === slot && isGenuinelyIndoor(layout[i].post)) { release = i; break; }
      }
      if (release >= 0) break;
    }
    if (release >= 0) layout.splice(release, 1);
  }

  // R3: rain swaps last, once every stop on every day is final — so a swap is never
  // also a stop somewhere, and never repeats across days. Null is honest when the
  // city has no unused indoor venue left.
  const stopIds = new Set(layouts.flatMap((l) => l.map((s) => s.post.id)));
  const takenSwaps = new Set();
  const sortedQ = [...q].sort(byId);
  const out = [];
  for (let d = 0; d < days; d++) {
    const stops = layouts[d];
    const centre = centroidOf(stops.map((s) => s.post));
    let rain = null, bestDist = Infinity;
    for (const p of sortedQ) {
      if (stopIds.has(p.id) || takenSwaps.has(p.id) || !isGenuinelyIndoor(p)) continue;
      const dist = kmFromPoint(centre, p);
      if (dist < bestDist) { bestDist = dist; rain = p; }
    }
    if (rain) takenSwaps.add(rain.id);
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
