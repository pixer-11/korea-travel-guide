# Itinerary Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pre-generated static itinerary pages (`/itinerary/seoul-3-days/`, 5 locales) assembled by a constraint solver from verified venue posts, with a no-LLM client-side personalization filter.

**Architecture:** A pure solver library (`src/lib/itinerary.mjs`, shared by build scripts AND Astro pages) turns qualifying posts into day plans (geo-clustered, hours/quiet-aware, dwell-budgeted). A build script writes one content file per city×days variant storing ONLY structure + AI connective prose — every hard fact is re-read from the source post at render time, so itineraries self-heal when posts change. A validator gates publication. Pages render zero-JS-complete; a small script adds pace/interest filtering and a date picker.

**Tech Stack:** Astro 5 content collections (glob loader, patterns identical to `postI18n`), node:test, js-yaml, Anthropic tool-use (structured output, same as `writer.mjs`/`translate-posts.mjs`), GitHub Actions (`publish.yml`).

## Global Constraints (from spec — repeat in every task's head)

- **Closed-world**: the model NEVER names a venue/address/rating/hour/price. Facts render from the source post only; itinerary files store slugs + prose.
- Gates: ≥12 qualifying posts → 3-day page; ≥15 → "packed" filter option; ≥24 → 5-day page. Qualifying = not draft, has `place.lat`+`place.lng`, `businessStatus` not `CLOSED_*`, category ≠ `event`.
- Day budget: dwell + walking ≤ 10 h (600 min); validator rejects otherwise.
- Walking legs > 2 km → labeled transit, never a walking estimate.
- Launch cities only: Seoul, Tokyo, Bangkok. Max 2 NEW cities/week thereafter (anti-spam).
- All 5 locales (`en` unprefixed, `/ko /ja /es /zh`) ship together; en renders even if a translation is missing (fallback, same as posts).
- AI-assisted disclosure + `rel="sponsored"` on affiliate links, `klookLocale(lang)` for Klook.
- No gender input anywhere. Filter inputs: pace / party / interests / arrival date.
- Windows dev box: run node with forward-slash paths; `npm test` = `node --test` (runs `*.test.mjs` under src/ and scripts/).

## File Map

- Create: `src/lib/itinerary.mjs` (solver, pure), `src/lib/itinerary.test.mjs`
- Create: `scripts/build-itineraries.mjs` (orchestrator + Claude prose)
- Create: `scripts/validate-itineraries.mjs` (CI gate)
- Create: `scripts/translate-itineraries.mjs` (prose → ko/ja/es/zh)
- Create: `src/components/ItineraryPage.astro`, `src/pages/itinerary/index.astro`, `src/pages/itinerary/[...slug].astro`, `src/pages/[lang]/itinerary/index.astro`, `src/pages/[lang]/itinerary/[...slug].astro`
- Modify: `src/content.config.ts` (2 new collections), `src/components/PostArticle.astro` (featured-in backlink), `scripts/generate.mjs` (queue boost), `.github/workflows/publish.yml` (pipeline steps), `src/pages/llms.txt.ts` (list itineraries)
- Content out: `src/content/itineraries/<city-slug>-<n>-days.md`, `src/content/itineraries-i18n/<lang>/<id>.md`

---

### Task 1: Solver library — qualification, clustering, ordering, legs, budget

**Files:**
- Create: `src/lib/itinerary.mjs`
- Test: `src/lib/itinerary.test.mjs` (pattern: `src/lib/interest.test.mjs`, plain `node:test`)

**Interfaces (Produces — later tasks import these exact names):**
```js
qualifyingPosts(posts)                    // → filtered array (rules in Global Constraints)
closedDaysOf(openingHours)                // ['Tuesday'] from Places weekday strings
dwellMinutes(post)                        // vetted-prose "plan on 2-3 hours" → 150, else category default
walkLeg(a, b)                             // {km, minutes, transit:boolean} haversine @ 4.5km/h, transit if >2km
buildItinerary(posts, {days})             // → {days:[{stops:[{slug, slot, dwellMin, walkToNext}], rainSwapSlug}], ok, reason}
gateFor(qualifyingCount)                  // → {threeDay, packed, fiveDay} booleans
```

- [ ] **Step 1: failing tests** — write `src/lib/itinerary.test.mjs` with synthetic posts (no fixtures from real content):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qualifyingPosts, closedDaysOf, dwellMinutes, walkLeg, buildItinerary, gateFor } from './itinerary.mjs';

const P = (id, lat, lng, cat = 'attraction', extra = {}) => ({
  id, data: { title: id, category: cat, draft: false,
    place: { lat, lng, businessStatus: 'OPERATIONAL', ...extra.place },
    tags: [], ...extra } });

test('qualifying excludes drafts, events, closed, coordless', () => {
  const posts = [
    P('a', 37.5, 127.0),
    { id: 'draft', data: { ...P('d', 37.5, 127).data, draft: true } },
    P('ev', 37.5, 127.0, 'event'),
    P('closed', 37.5, 127.0, 'attraction', { place: { lat: 37.5, lng: 127, businessStatus: 'CLOSED_PERMANENTLY' } }),
    { id: 'nogeo', data: { title: 'x', category: 'attraction', draft: false, place: {}, tags: [] } },
  ];
  assert.deepEqual(qualifyingPosts(posts).map((p) => p.id), ['a']);
});

test('closedDaysOf parses Places weekday strings', () => {
  assert.deepEqual(closedDaysOf(['Monday: 9:00 AM – 6:00 PM', 'Tuesday: Closed']), ['Tuesday']);
  assert.deepEqual(closedDaysOf(undefined), []);
});

test('dwellMinutes: extracted from prose else category default', () => {
  assert.equal(dwellMinutes({ data: { category: 'attraction' }, body: 'Plan on 2-3 hours here.' }), 150);
  assert.equal(dwellMinutes({ data: { category: 'restaurant' }, body: '' }), 60);
  assert.equal(dwellMinutes({ data: { category: 'attraction' }, body: '' }), 120);
});

test('walkLeg: haversine, >2km flips to transit', () => {
  const a = { data: { place: { lat: 37.5796, lng: 126.977 } } };  // Gyeongbokgung
  const b = { data: { place: { lat: 37.5826, lng: 126.9831 } } }; // ~0.65km NE
  const leg = walkLeg(a, b);
  assert.ok(leg.km > 0.4 && leg.km < 0.9);
  assert.equal(leg.transit, false);
  const far = walkLeg(a, { data: { place: { lat: 37.51, lng: 127.06 } } }); // Gangnam ~10km
  assert.equal(far.transit, true);
});

test('buildItinerary: 12 posts → 3 days × 4, meals in meal slots, budget kept', () => {
  // two geographic clusters + restaurants in each
  const posts = [];
  for (let i = 0; i < 5; i++) posts.push(P(`north${i}`, 37.58 + i * 0.002, 126.98));
  posts.push(P('north-rest', 37.581, 126.979, 'restaurant'));
  for (let i = 0; i < 5; i++) posts.push(P(`south${i}`, 37.51 + i * 0.002, 127.06));
  posts.push(P('south-rest', 37.511, 127.059, 'restaurant'));
  const it = buildItinerary(posts, { days: 3 });
  assert.equal(it.ok, true);
  assert.equal(it.days.length, 3);
  for (const d of it.days) {
    assert.ok(d.stops.length >= 3 && d.stops.length <= 5);
    const lunch = d.stops.find((s) => s.slot === 'lunch');
    if (lunch) assert.ok(lunch.slug.includes('rest'));
    const total = d.stops.reduce((m, s) => m + s.dwellMin + (s.walkToNext?.transit ? 30 : s.walkToNext?.minutes || 0), 0);
    assert.ok(total <= 600, `day over budget: ${total}`);
    // no zigzag: consecutive stops within same cluster stay near
  }
  // no stop reused across days
  const all = it.days.flatMap((d) => d.stops.map((s) => s.slug));
  assert.equal(new Set(all).size, all.length);
});

test('gateFor thresholds', () => {
  assert.deepEqual(gateFor(11), { threeDay: false, packed: false, fiveDay: false });
  assert.deepEqual(gateFor(12), { threeDay: true, packed: false, fiveDay: false });
  assert.deepEqual(gateFor(15), { threeDay: true, packed: true, fiveDay: false });
  assert.deepEqual(gateFor(24), { threeDay: true, packed: true, fiveDay: true });
});
```

- [ ] **Step 2:** `node --test src/lib/itinerary.test.mjs` → FAIL (module not found).
- [ ] **Step 3: implement** `src/lib/itinerary.mjs` (ESM, no deps — importable by Astro AND scripts, like `interest.mjs`):

```js
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
  const h = /(?:plan on|allow|budget|spend)\s+(?:about\s+|around\s+)?(\d+)(?:\s*[-–to]+\s*(\d+))?\s*hours?/i.exec(body);
  const m = /(?:plan on|allow|budget|spend)\s+(?:about\s+|around\s+)?(\d+)(?:\s*[-–to]+\s*(\d+))?\s*min/i.exec(body);
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
```

- [ ] **Step 4:** `node --test src/lib/itinerary.test.mjs` → ALL PASS. If clustering flakes on the synthetic set, fix the solver (not the test).
- [ ] **Step 5:** `git add src/lib/itinerary.mjs src/lib/itinerary.test.mjs && git commit -m "feat: itinerary solver library (pure, tested)"`

### Task 2: Content collections for itineraries

**Files:**
- Modify: `src/content.config.ts` (append two collections + export)

**Interfaces (Produces):** collections `itineraries` (id `<city-slug>-<n>-days`) and `itinerariesI18n` (id `<lang>/<same-id>`); shapes below are relied on by Tasks 3–6.

- [ ] **Step 1:** add to `src/content.config.ts` before the final export (schema mirrors spec §1/§2 — structure only, NO facts):

```ts
// Pre-generated itinerary pages (spec 2026-07-27). Stores ONLY structure + AI
// connective prose keyed by post slug — every hard fact (rating/hours/coords/
// quiet times) is read from the source post at render time, so an itinerary can
// never contradict or outlive the verified data. Built by scripts/build-itineraries.mjs.
const itineraries = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/itineraries' }),
  schema: z.object({
    city: z.string(),          // display region name, e.g. "Seoul" (matches posts' region)
    country: z.string(),
    days: z.number().int().min(1).max(7),
    title: z.string(),
    description: z.string(),
    quickAnswer: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    stopsHash: z.string(),     // sha1 of ordered stop slugs — regen/retranslate trigger
    packedAvailable: z.boolean().default(false), // gate ≥15 (filter option visibility)
    faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
    itinerary: z.array(z.object({
      label: z.string(),       // AI: "Palaces & hanok lanes"
      intro: z.string(),       // AI connective prose for the day
      stops: z.array(z.object({
        slug: z.string(),      // MUST resolve to a live post — validator enforces
        slot: z.enum(['morning', 'lunch', 'afternoon', 'evening']),
        why: z.string(),       // AI 1-2 sentences, facts injected from the post
        dwellMin: z.number(),
        walkToNext: z.object({ km: z.number(), minutes: z.number(), transit: z.boolean() }).nullable(),
      })),
      rainSwapSlug: z.string().nullable().default(null),
    })),
    aiGenerated: z.boolean().default(true),
    draft: z.boolean().default(false),
  }),
});
// Translated itinerary PROSE (same design as postI18n: facts stay in EN sources).
const itinerariesI18n = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/itineraries-i18n',
    generateId: ({ entry }) => entry.replace(/\.md$/, '') }),
  schema: z.object({
    lang: z.enum(['ko', 'ja', 'es', 'zh']),
    slug: z.string(),
    sourceHash: z.string(),    // copy of stopsHash at translation time — staleness check
    title: z.string(), description: z.string(), quickAnswer: z.string(),
    faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
    days: z.array(z.object({ label: z.string(), intro: z.string() })),
    whys: z.record(z.string(), z.string()).default({}),      // slug → translated why
    rainWhys: z.record(z.string(), z.string()).default({}),  // slug → translated swap note
  }),
});
```
and add `itineraries, itinerariesI18n` to the exported `collections`.

- [ ] **Step 2:** `mkdir src/content/itineraries src/content/itineraries-i18n` with a `.gitkeep` each; `npx astro check 2>&1 | head` (type errors only in new code are fixable; pre-existing warnings ignore) and `npm run build` must still pass with empty collections.
- [ ] **Step 3:** `git add -A src/content.config.ts src/content/itineraries src/content/itineraries-i18n && git commit -m "feat: itinerary content collections"`

### Task 3: Builder script — assembly + Claude connective prose

**Files:**
- Create: `scripts/build-itineraries.mjs`

**Interfaces:**
- Consumes: `buildItinerary`, `qualifyingPosts`, `gateFor`, `closedDaysOf`, `dwellMinutes` from `../src/lib/itinerary.mjs`; env `ANTHROPIC_API_KEY` via `./lib/env.mjs`; posts read like `scripts/translate-posts.mjs` does.
- Produces: `src/content/itineraries/<city-slug>-<n>-days.md`; stdout line `NEW_ITINERARY: <city> <days>d` per newly created file (workflow Telegram step greps it); exit 0 idempotent.

Key requirements (all must appear in code):
1. City list = LAUNCH_CITIES `['Seoul','Tokyo','Bangkok']` **plus** any region whose qualifying count passes `gateFor().threeDay` — but cap NEW cities (files that don't exist yet, beyond launch three) at 2 per run (spec anti-spam; the workflow runs daily so this is ≤2/week in practice only if gated — enforce with `data/itineraries-state.json` recording `{citySlug: firstPublished}` and skipping if 2 cities were added in the past 7 days).
2. `stopsHash = sha1(days.map(d=>d.stops.map(s=>s.slug).join(',')).join('|'))`. If an existing file has the same hash → skip (idempotent). If >2 stop slugs differ → regenerate prose; else keep existing prose and just update structure numbers.
3. Claude call (model `claude-sonnet-5`, tool-use like `translate-posts.mjs`): ONE call per city×days variant. Prompt injects, per stop: title, category, quickAnswer, closedDays, quiet-window summary, dwell minutes, walk legs — and instructs: *"Write label+intro per day and a 1-2 sentence 'why' per stop plus 3-5 FAQ entries. You may ONLY reference the venues and facts listed. Never introduce a venue, price, time, or claim not present in the input. Never state opening hours in prose (the page shows them from data)."* Tool schema returns `{title, description, quickAnswer, days:[{label,intro}], whys:{slug:string}, rainWhys:{slug:string}, faq:[{q,a}]}`.
4. Write frontmatter with js-yaml (round-trip pattern from `regenerate-content.mjs`), body empty.
5. `--city=Seoul --days=3` flags for manual runs; default sweeps all.

- [ ] **Step 1:** write the script per above.
- [ ] **Step 2: real-data smoke test:** `node scripts/build-itineraries.mjs --city=Seoul --days=3` → file `src/content/itineraries/seoul-3-days.md` exists; open it and MANUALLY verify: every `slug` is a real post file; walk legs plausible; no venue in prose that isn't a stop. Then rerun the same command → "unchanged, skipping" (idempotency proof).
- [ ] **Step 3:** run Tokyo + Bangkok. `npm run build` passes (pages don't render yet — collections just load).
- [ ] **Step 4:** `git add scripts/build-itineraries.mjs src/content/itineraries data/itineraries-state.json && git commit -m "feat: itinerary builder with closed-world prose"`

### Task 4: Validator gate

**Files:**
- Create: `scripts/validate-itineraries.mjs` (pattern: `scripts/validate-content.mjs` — print issues, exit 1 if any)

**Interfaces:** Consumes solver fns + both content dirs. Produces exit code for CI; run inside `build-itineraries.mjs` after writing (a failed city is deleted + reported, never committed) AND standalone in publish.yml.

Checks (each with a test fixture in step 1):
- every `stops[].slug` resolves to an existing, non-draft post file with lat/lng and non-CLOSED status
- no duplicate slug within one itinerary
- per-day `dwell + legs total ≤ 600` and `3 ≤ stops ≤ 5`
- `walkToNext.transit === false` implies `km ≤ 2`
- lunch slot (when present) is `category: restaurant`
- `packedAvailable` true only if qualifying count ≥ 15 (recount live)
- every i18n file's `sourceHash` matches its source's `stopsHash` (stale → issue, printed as `STALE-TRANSLATION`)
- prose sanity: every day `label`/`intro` non-empty; every stop has a `why`

- [ ] **Step 1:** write validator with a `--fixture=<dir>` flag; create `scripts/lib/itinerary-fixtures/` containing one GOOD and one BAD (dupe slug + over-budget) sample; assert exit codes 0/1 respectively via `node --test scripts/validate-itineraries.test.mjs` (spawn with `node:child_process` `execFileSync`, expect throw on BAD).
- [ ] **Step 2:** run against real content → exit 0. Wire the call into `build-itineraries.mjs` (build → validate → on failure delete the new file, log `VALIDATE-FAILED <id>`).
- [ ] **Step 3:** `git add scripts/validate-itineraries.mjs scripts/validate-itineraries.test.mjs scripts/lib/itinerary-fixtures && git commit -m "feat: itinerary validator gate"`

### Task 5: Translations

**Files:**
- Create: `scripts/translate-itineraries.mjs` (clone the structure of `scripts/translate-posts.mjs`: resumable, `--limit --lang --force`, CONCURRENCY, tool-use)

**Interfaces:** Consumes `src/content/itineraries/*.md`; Produces `src/content/itineraries-i18n/<lang>/<id>.md` matching the `itinerariesI18n` schema exactly (incl. `sourceHash` = source's current `stopsHash`). Skip when the target exists AND `sourceHash` matches (stale files get re-translated — this is the regen path).

- [ ] **Step 1:** write script; translate prose fields only (`title, description, quickAnswer, faq, days[].label, days[].intro, whys, rainWhys`).
- [ ] **Step 2:** `node scripts/translate-itineraries.mjs --limit=1 --lang=ko` → inspect the ko file by eye (natural Korean, no facts added). Then full run (3 cities × 4 langs = 12 files).
- [ ] **Step 3:** `node scripts/validate-itineraries.mjs` → 0 issues (hash checks pass). Commit: `git add scripts/translate-itineraries.mjs src/content/itineraries-i18n && git commit -m "feat: itinerary translations"`

### Task 6: Pages — ItineraryPage component + routes (all 5 locales)

**Files:**
- Create: `src/components/ItineraryPage.astro` (single template, both EN and localized routes — same pattern as `PostArticle.astro`)
- Create: `src/pages/itinerary/[...slug].astro`, `src/pages/itinerary/index.astro`
- Create: `src/pages/[lang]/itinerary/[...slug].astro`, `src/pages/[lang]/itinerary/index.astro`

**Interfaces:** Consumes collections (Task 2), solver fns for closedDays (`closedDaysOf(post.data.place.openingHours)`), `PlanTrip`/`Newsletter` components, `klookLocale`/`useTranslations`/`localizePath` from `src/i18n/utils`, `BaseLayout` (look at `PostArticle.astro` for props: title/description/og). Route ids: `/itinerary/seoul-3-days/`.

Page anatomy — implement in THIS order (spec §1 + validated audit findings):
1. H1 + quickAnswer (answer-first).
2. Trust strip: "Hours & ratings from Google Places · routes computed from coordinates · updated {updatedDate}" + AI-assisted disclosure (honest-trust audit finding; reuse post disclosure copy keys).
3. Filter bar (`<details>`-based, works without JS as plain content): pace (radio: relaxed/normal/packed — packed only rendered when `packedAvailable`), party (solo/couple/family/seniors), interests (food/culture/nature/shopping/nightlife), arrival-date `<input type="date">`. All progressive enhancement — Task 7 wires it.
4. Sticky day nav ("Day 1 · Day 2 · Day 3" anchor links; audit HIGH).
5. Per day: `<section id="day-N">` → AI label+intro → stop cards. Stop card renders FROM THE POST (fetch by slug via `getCollection('posts')` map): title link → `localizePath('/posts/'+slug)`, hero thumbnail (post's heroImage, already vision-verified), ★rating + review count, closed-day warning chip when `closedDaysOf(...)` non-empty (**audit kill-shot: render prominently**), quiet badge when `busyness.weekdayQuiet` intersects the slot hours ("Quietest 8–10 am"), verified transit tip: first line of post body matching /(Line \d|Station|Exit \d|BTS|MRT)/ if any, dwell "~2.5 h", localized place name via `localizePlace`.
6. Between cards: leg row — "~12 min walk (0.9 km)" or "Take the subway/taxi" + Google Maps directions link `https://www.google.com/maps/dir/?api=1&origin=LAT,LNG&destination=LAT,LNG&travelmode=walking|transit` (no API key needed).
7. Day footer: rain-swap box ("If it rains: {post title}" linking the post, with `rainWhys` prose) + per-day multi-stop route link (`/maps/dir/?api=1&origin=..&destination=..&waypoints=LAT,LNG|LAT,LNG`) + day-scoped Klook CTA: message-matched label `t('itin.bookDay').replace('{n}',..)`, href = same builder as `PlanTrip` klookHref (city query), `rel="sponsored noopener"`.
8. After Day sections: FAQ block, `PlanTrip` (existing), `Newsletter` with `signupSource="itinerary"` (check `Newsletter.astro` props — if it lacks a source prop, add optional prop defaulting current behavior), related region-hub links.
9. `<script type="application/ld+json">`: `TouristTrip` (name, description, `itinerary` as `ItemList` of `TouristAttraction` with name + url) + `BreadcrumbList` + `FAQPage`. NO aggregateRating (site precedent).
10. Print stylesheet: `@media print` — hide filter/nav/CTAs, linearize cards (audit MED, trivial).
11. hreflang: follow whatever `PostArticle.astro`/BaseLayout already does for localized posts (same mechanism, `x-default` = EN).

Localized route: EN fields swapped for `itinerariesI18n` entry when present (fallback EN — build must not fail on a missing translation).
Index pages (`/itinerary/`): list all non-draft itineraries as cards (city, days, stop count, hero = first stop's image) — thin but real hub; link it from the destinations hub later task.

- [ ] **Step 1:** build `ItineraryPage.astro` + EN routes; `npm run build`; open `dist/itinerary/seoul-3-days/index.html` and verify: every stop title matches its post, closed-day chip on the Tuesday-closed palace, walk legs render, directions URLs contain both coordinate pairs, JSON-LD parses (paste into a JSON parser), print CSS present.
- [ ] **Step 2:** add `[lang]` routes; rebuild; check `dist/ko/itinerary/seoul-3-days/index.html` shows Korean prose + Korean UI labels (add any new `t()` keys to ALL 5 langs in `src/i18n/ui.ts` — grep an existing key like `widget.toursLabel` to find the file/pattern).
- [ ] **Step 3:** run existing suite `npm test` + `node scripts/validate-itineraries.mjs`.
- [ ] **Step 4:** `git add -A src/components/ItineraryPage.astro src/pages/itinerary "src/pages/[lang]/itinerary" src/i18n/ui.ts && git commit -m "feat: itinerary pages, 5 locales"`

### Task 7: Client-side filter + date awareness (progressive enhancement)

**Files:**
- Modify: `src/components/ItineraryPage.astro` (one inline `<script>` at the end, vanilla TS like `StickyBook.astro`)

Behavior (all honest — computation only, no invention):
- Every stop card carries `data-slug data-priority data-lat data-lng data-cats data-closed="Tuesday,..." data-dwell`. Priority = solver order index within its day.
- **Pace**: relaxed hides priority>3 cards per day, normal >4, packed shows all (packed radio only exists when `packedAvailable`). After hiding, legs between now-adjacent visible cards are recomputed client-side with the same haversine constants (duplicate the 3-line formula in the script; keep `WALK_KMH=4.5`, detour ×1.3, >2 km → "subway/taxi" — MUST match `src/lib/itinerary.mjs` values, note referencing both files).
- **Party**: family/seniors → shows per-card advisory chips only (e.g. long-walk warning when next leg >15 min); never reorders.
- **Interests**: matching cards (category/tags intersect) get a highlight ring; non-matching dim to 60% — never hidden (the plan stays complete).
- **Arrival date**: given a date, each Day N gets its real weekday label ("Day 1 · Fri Mar 6"); any stop whose `data-closed` contains that weekday flips its chip to "⚠ Closed that day — swap with the rain-plan below"; the `.ics` link updates (see below).
- **Add to calendar**: an `.ics` per day generated client-side (template string, RFC pattern copied from `src/lib/ics.ts` fold/escape rules) as a `data:` URL download — only enabled once a date is chosen.
- **Share**: filter state serialized into `location.hash` (`#p=relaxed&i=food&d=2026-03-06`); on load, hash re-applies. IKEA-effect hook: after the FIRST filter interaction, un-collapse the email block heading to "Save this plan — email it to yourself" (`Newsletter` block already on page; just scrollIntoView affordance, no popup).
- All listeners feature-detect; zero errors with JS off (build renders complete page).

- [ ] **Step 1:** implement; `npm run build && npx astro preview` → in the Browser pane verify: pace toggle hides cards + recomputes leg text; date pick flags the Tuesday-closed stop when a Tuesday lands on its day; hash round-trips on reload; `.ics` downloads and opens.
- [ ] **Step 2:** JS-off check: `curl` the built HTML and confirm all stops present (no client-only content).
- [ ] **Step 3:** `git add src/components/ItineraryPage.astro && git commit -m "feat: itinerary client filter, date awareness, ics"`

### Task 8: Cross-links — posts backlink block, hubs, llms.txt

**Files:**
- Modify: `src/components/PostArticle.astro` (after the Related block ~line 117-130 area): if any itinerary contains this post's slug → "🗺 This spot is Day {n} of our {city} {days}-day itinerary" link card (both directions of the flywheel, spec §3). Compute via `getCollection('itineraries')` once.
- Modify: destinations country hub + region hub templates (find them: `src/pages/destinations/[country].astro`, `src/pages/regions/[region].astro` + `[lang]` twins): when the region has an itinerary, render a prominent "3-day itinerary" card at top. Follow each file's existing card markup.
- Modify: `src/pages/llms.txt.ts`: add an `## Itineraries` section listing itinerary URLs (AI-citation surface).
- Sitemap: automatic via `getStaticPaths` (verify presence in `dist/sitemap-*.xml` — no code unless missing).

- [ ] **Step 1:** implement all three; rebuild; verify the Gyeongbokgung post page shows the backlink card, region hub Seoul shows the itinerary card, llms.txt lists 3 URLs, sitemap contains `/itinerary/seoul-3-days/` ×5 locales.
- [ ] **Step 2:** `npm test` (regressions) then commit `feat: itinerary cross-links (posts, hubs, llms.txt, sitemap)`.

### Task 9: Automation — publish.yml + generation weighting + Telegram

**Files:**
- Modify: `.github/workflows/publish.yml`: after the "Generate region intros" step, insert (mirror surrounding style, `continue-on-error: true` except validator):
```yaml
      - name: Build/refresh itinerary pages
        continue-on-error: true
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: node scripts/build-itineraries.mjs | tee itin.log
      - name: Translate itineraries (ko/ja/es/zh)
        continue-on-error: true
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: node scripts/translate-itineraries.mjs
```
  add `src/content/itineraries src/content/itineraries-i18n data/itineraries-state.json` to the `git add` line of the commit step; add a validate step next to `validate-content` calling `scripts/validate-itineraries.mjs` with the same Telegram-warning pattern (Korean text: `⚠️ 일정 페이지 검증 경고`); add a new-city notice step: if `grep NEW_ITINERARY itin.log`, send Korean Telegram `🗺️ 새 일정 페이지 오픈: {city} {days}일 — https://wanderatlasguides.com/itinerary/...` (follow the existing curl pattern; per standing rule ALL Telegram text Korean).
- Modify: `scripts/generate.mjs` queue builder: next to the existing "near-roundup boost" (~line 247), add an **itinerary-gate boost**: regions within 3 posts of a gate (12 or 24) get their targets pulled forward the same stable-partition way. Reuse the region counts already computed there. Comment it as: `// Itinerary-gate boost: a region at 9-11 (or 21-23) qualifying posts is close to unlocking an itinerary page — filling those first compounds (spec 2026-07-27).`

- [ ] **Step 1:** implement both; `node scripts/generate.mjs` DRY check: run with `DUMMY=1 POSTS_PER_RUN=0` if supported or just import-check `node -e "import('./scripts/generate.mjs')"` — must not throw; `npx action-validator .github/workflows/publish.yml` or a YAML parse (`node -e "require('js-yaml').load(...)"`) for syntax.
- [ ] **Step 2:** commit `feat: itinerary automation in daily publish + gate-boosted generation`.

### Task 10: Ship + verify live (standing directive)

- [ ] **Step 1:** `npm run build` final green; `npm test`; both validators exit 0.
- [ ] **Step 2:** push to main (auto-deploys). Watch the deploy, then fetch `https://wanderatlasguides.com/itinerary/seoul-3-days/` (+ /ko /ja) — 200s, content correct.
- [ ] **Step 3:** Spawn verification subagents on the LIVE pages per the always-verify-with-subagents directive: (a) fact-checker — every stop's rating/closed-day/coordinates on the page vs. its source post file; (b) UX/link checker — all internal links, directions URLs, JSON-LD validity, all 5 locales, mobile viewport; report findings, fix anything red before declaring done.
- [ ] **Step 4:** Trigger one manual `workflow_dispatch` of publish.yml and confirm the itinerary steps run green in Actions + Korean Telegram messages arrive.
- [ ] **Step 5:** Update memory (`wander-atlas-next-tasks` / new `wander-atlas-itineraries` memory file): live state, gates, 8-week success metrics (Search Console `/itinerary/*` impressions, Klook clicks, `signup_source=itinerary` signups — spec §6).

## Self-Review (done at write time)

- Spec coverage: §1 anatomy → T6; §2 accuracy rules → T1/T3/T4; §3 conversion → T6/T7/T8; §4 automation → T9; §5 exclusions respected (no runtime AI, no gender, no accounts); §6 measures → T10.5. Trend/audit adds: quiet badges/closed chips/night-slot/rain swap/date picker/ics/print/sticky nav/themed-variant *engine deferred* — themed variants (foodie/K-drama) intentionally NOT in v1: no city currently passes a per-theme gate honestly (Seoul has ~5 restaurants). The gate logic (Task 1) makes them a data-arrival follow-up, not a launch promise.
- Placeholders: none (every step has code or an exact file/command).
- Type consistency: `walkToNext {km,minutes,transit}`, `stopsHash`/`sourceHash`, `packedAvailable`, `NEW_ITINERARY:` marker — names checked across T1-T9.
