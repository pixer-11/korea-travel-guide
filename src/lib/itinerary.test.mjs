import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qualifyingPosts, closedDaysOf, dwellMinutes, walkLeg, buildItinerary, gateFor, preferredSlot, DAY_MIN_MINUTES } from './itinerary.mjs';

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

test('dwellMinutes: recognizes guide phrasings (hour-long, couple of hours, minutes, quick stop, etc.)', () => {
  // Existing "plan on" should still work
  assert.equal(dwellMinutes({ data: { category: 'attraction' }, body: 'Plan on 2-3 hours' }), 150);

  // "hour-long"
  assert.equal(dwellMinutes({ data: { category: 'attraction' }, body: 'ideal for an hour-long stroll' }), 60);

  // Real Cheonggyecheon case: multiple sentences, guard words present
  // First sentence has "hour-long" before "rather than", second has "full" before "3+ hours"
  // Result should be 60 from first sentence (extracted before "rather than")
  assert.equal(
    dwellMinutes({
      data: { category: 'attraction' },
      body: 'ideal for an hour-long stroll rather than a whole-day destination. Walking the full 11 km to Dongdaemun takes 3+ hours.'
    }),
    60
  );

  // "a couple of hours"
  assert.equal(dwellMinutes({ data: { category: 'attraction' }, body: 'a couple of hours exploring' }), 120);

  // "a few hours"
  assert.equal(dwellMinutes({ data: { category: 'attraction' }, body: 'allow a few hours here' }), 150);

  // "half-day"
  assert.equal(dwellMinutes({ data: { category: 'attraction' }, body: 'a half-day adventure' }), 240);

  // "N-hour" with digits
  assert.equal(dwellMinutes({ data: { category: 'attraction' }, body: 'a 2-hour walk' }), 120);

  // "N-hour" with words
  assert.equal(dwellMinutes({ data: { category: 'attraction' }, body: 'a three-hour experience' }), 180);

  // "N minutes" without preceding verb
  assert.equal(dwellMinutes({ data: { category: 'attraction' }, body: 'takes about 40 minutes' }), 40);

  // "N-minute walk"
  assert.equal(dwellMinutes({ data: { category: 'attraction' }, body: 'a 30-minute stroll' }), 30);

  // "quick stop"
  assert.equal(dwellMinutes({ data: { category: 'attraction' }, body: 'a quick stop for photos' }), 30);

  // No duration phrase → category default
  assert.equal(dwellMinutes({ data: { category: 'attraction' }, body: 'A nice place' }), 120);
  assert.equal(dwellMinutes({ data: { category: 'restaurant' }, body: 'Great food' }), 60);
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

test('buildItinerary: restaurant-only cluster returns ok:false (never empty days)', () => {
  const posts = [];
  for (let i = 0; i < 12; i++) posts.push(P(`rest${i}`, 37.5 + i * 0.001, 127.0, 'restaurant'));
  const it = buildItinerary(posts, { days: 3 });
  assert.equal(it.ok, false);
  assert.match(it.reason, /restaurant|no stops/i);
  assert.equal(it.days.length, 0);
});

test('buildItinerary: under-provisioned input (4 posts for 2 days) returns ok:false', () => {
  const posts = [];
  for (let i = 0; i < 4; i++) posts.push(P(`p${i}`, 37.5 + i * 0.001, 127.0));
  const it = buildItinerary(posts, { days: 2 });
  assert.equal(it.ok, false);
  assert.match(it.reason, /minimum.*needed/i);
  assert.equal(it.days.length, 0);
});

test('dwellMinutes: regex matches hyphen, en-dash, and "to" separator', () => {
  assert.equal(dwellMinutes({ data: { category: 'attraction' }, body: 'Plan on 2-3 hours here.' }), 150);
  assert.equal(dwellMinutes({ data: { category: 'attraction' }, body: 'Plan on 2–3 hours here.' }), 150);
  assert.equal(dwellMinutes({ data: { category: 'attraction' }, body: 'Plan on 2 to 3 hours here.' }), 150);
  assert.equal(dwellMinutes({ data: { category: 'attraction' }, body: 'Allow 30-45 minutes here.' }), 38);
});

test('dwellMinutes: real Seoul cases with decimals and ranges', () => {
  // seoul-ikseon-dong.md: "Budget 1.5 to 2 hours for a relaxed wander"
  const ik = dwellMinutes({ data: { category: 'attraction' }, body: 'Budget 1.5 to 2 hours for a relaxed wander' });
  assert.ok(ik >= 100 && ik <= 110, `ikseon should be ~105, got ${ik}`);

  // seoul-myeongdong-shopping-street.md: "Budget 2-3 hours"
  assert.equal(dwellMinutes({ data: { category: 'attraction' }, body: 'Budget 2-3 hours' }), 150);

  // seoul-cheonggyecheon.md: guard against "full 11 km takes 3+ hours", extract "30-45 minutes" instead
  const cheon = dwellMinutes({
    data: { category: 'attraction' },
    body: '30-45 minutes. Walking the full 11 km to Dongdaemun takes 3+ hours.'
  });
  assert.ok(cheon >= 37 && cheon <= 43, `cheonggyecheon should be ~40, got ${cheon}`);
});

test('walkLeg: transit legs return null for minutes', () => {
  const a = { data: { place: { lat: 37.5, lng: 126.9 } } };
  const b = { data: { place: { lat: 37.4, lng: 127.1 } } }; // ~12km away (transit)
  const leg = walkLeg(a, b);
  assert.equal(leg.transit, true, 'should be marked as transit');
  assert.equal(leg.minutes, null, 'transit legs should have null minutes, not an invented walking time');
  assert.ok(leg.km > 2, 'km should still be calculated');
});

test('walkLeg: short legs have walking minutes', () => {
  const a = { data: { place: { lat: 37.58, lng: 126.98 } } };
  const b = { data: { place: { lat: 37.582, lng: 126.981 } } }; // ~0.3km
  const leg = walkLeg(a, b);
  assert.equal(leg.transit, false, 'should not be transit');
  assert.ok(typeof leg.minutes === 'number', 'walkable legs should have numeric minutes');
  assert.ok(leg.minutes > 0, 'minutes should be positive');
});

test('buildItinerary: regression — lopsided cluster distribution (10 tight + 2 far outliers) terminates', () => {
  // Simulates real-world distribution: 10 posts tightly clustered in Seoul core,
  // 2 far outliers. This previously caused oscillation in rebalance loop.
  // Test: must return (ok true or false) — assertion is termination, not plan quality.
  const posts = [];
  // 10 posts in tight Seoul core cluster (within ~0.01° of 37.58/126.98)
  for (let i = 0; i < 10; i++) {
    posts.push(P(`seoul${i}`, 37.58 + (Math.random() - 0.5) * 0.01, 126.98 + (Math.random() - 0.5) * 0.01));
  }
  // 2 far outliers
  posts.push(P('outlier1', 37.51, 127.06));  // Gangnam area (~9km south-east)
  posts.push(P('outlier2', 37.45, 126.70));  // Incheon area (~30km west)

  const startTime = Date.now();
  const it = buildItinerary(posts, { days: 3 });
  const elapsed = Date.now() - startTime;

  // Assertion 1: Must return within reasonable time (not hang)
  assert.ok(elapsed < 5000, `buildItinerary took ${elapsed}ms (should complete in <5s)`);

  // Assertion 2: Returns either ok:true (balanced plan) or ok:false (couldn't balance)
  assert.ok(typeof it.ok === 'boolean');

  // Assertion 3: If ok:true, every day has ≥1 stop (never empty days)
  if (it.ok) {
    assert.ok(it.days.length === 3);
    for (const d of it.days) {
      assert.ok(d.stops.length >= 1, 'ok:true requires all days to have ≥1 stop');
    }
  }
});

test('buildItinerary: balanced valid input produces all days with ≥3 stops', () => {
  // Create a balanced, valid input: 15 posts across 3 geographic clusters,
  // evenly distributed to avoid triggering under-provision or rebalance issues.
  const posts = [];
  // Cluster 1: 5 posts + 1 restaurant = 6 posts
  for (let i = 0; i < 5; i++) posts.push(P(`c1_${i}`, 37.60 + i * 0.002, 126.95));
  posts.push(P('c1_rest', 37.601, 126.951, 'restaurant'));
  // Cluster 2: 5 posts + 1 restaurant = 6 posts
  for (let i = 0; i < 5; i++) posts.push(P(`c2_${i}`, 37.50 + i * 0.002, 127.10));
  posts.push(P('c2_rest', 37.501, 127.101, 'restaurant'));
  // Cluster 3: 3 posts = 3 posts (minimum viable)
  for (let i = 0; i < 3; i++) posts.push(P(`c3_${i}`, 37.40 + i * 0.002, 126.80));

  const it = buildItinerary(posts, { days: 3 });
  assert.equal(it.ok, true, 'balanced 15-post input should produce valid itinerary');
  assert.equal(it.days.length, 3);
  for (let i = 0; i < it.days.length; i++) {
    const d = it.days[i];
    assert.ok(d.stops.length >= 3, `day ${i + 1} must have ≥3 stops, got ${d.stops.length}`);
    assert.ok(d.stops.length <= 5, `day ${i + 1} must have ≤5 stops, got ${d.stops.length}`);
  }
});

test('chronological slot ordering: 12-post fixture with restaurants', () => {
  // Re-use the 12-post synthetic fixture to verify slots are chronologically ordered
  const posts = [];
  for (let i = 0; i < 5; i++) posts.push(P(`north${i}`, 37.58 + i * 0.002, 126.98));
  posts.push(P('north-rest', 37.581, 126.979, 'restaurant'));
  for (let i = 0; i < 5; i++) posts.push(P(`south${i}`, 37.51 + i * 0.002, 127.06));
  posts.push(P('south-rest', 37.511, 127.059, 'restaurant'));

  const it = buildItinerary(posts, { days: 3 });
  assert.equal(it.ok, true);

  // Slot rank: morning=0, lunch=1, afternoon=2, evening=3
  const slotRank = { morning: 0, lunch: 1, afternoon: 2, evening: 3 };

  for (let dayIdx = 0; dayIdx < it.days.length; dayIdx++) {
    const d = it.days[dayIdx];
    let lunchCount = 0;

    // Verify chronological ordering and count lunches
    for (let i = 0; i < d.stops.length; i++) {
      const s = d.stops[i];
      const rank = slotRank[s.slot];
      assert.ok(rank !== undefined, `day ${dayIdx + 1} stop ${i}: unknown slot '${s.slot}'`);
      if (s.slot === 'lunch') lunchCount++;

      // Check non-decreasing order
      if (i > 0) {
        const prevRank = slotRank[d.stops[i - 1].slot];
        assert.ok(prevRank <= rank, `day ${dayIdx + 1}: slot sequence not chronological: ${d.stops[i - 1].slot}(${prevRank}) then ${s.slot}(${rank})`);
      }
    }

    // At most one lunch per day
    assert.ok(lunchCount <= 1, `day ${dayIdx + 1}: found ${lunchCount} lunch slots, expected ≤1`);
  }
});

test('chronological slot ordering: two restaurants in one cluster', () => {
  // Test with two restaurants in the same cluster to verify dinner (second restaurant) handling
  const posts = [];
  // Cluster with 5 sights + 2 restaurants = 7 posts
  for (let i = 0; i < 5; i++) posts.push(P(`venue${i}`, 37.60 + i * 0.002, 126.95));
  posts.push(P('lunch-cafe', 37.601, 126.951, 'restaurant'));
  posts.push(P('dinner-restaurant', 37.602, 126.952, 'restaurant'));
  // Cluster 2: minimum viable (3 posts)
  for (let i = 0; i < 3; i++) posts.push(P(`far${i}`, 37.40 + i * 0.002, 126.80));
  // Cluster 3: minimum viable (3 posts)
  for (let i = 0; i < 3; i++) posts.push(P(`other${i}`, 37.50 + i * 0.002, 127.10));

  const it = buildItinerary(posts, { days: 3 });
  assert.equal(it.ok, true);

  const slotRank = { morning: 0, lunch: 1, afternoon: 2, evening: 3 };

  for (let dayIdx = 0; dayIdx < it.days.length; dayIdx++) {
    const d = it.days[dayIdx];
    let lunchCount = 0;

    // Verify chronological ordering
    for (let i = 0; i < d.stops.length; i++) {
      const s = d.stops[i];
      const rank = slotRank[s.slot];
      assert.ok(rank !== undefined, `day ${dayIdx + 1} stop ${i}: unknown slot '${s.slot}'`);
      if (s.slot === 'lunch') lunchCount++;

      if (i > 0) {
        const prevRank = slotRank[d.stops[i - 1].slot];
        assert.ok(prevRank <= rank, `day ${dayIdx + 1}: slot sequence not chronological: ${d.stops[i - 1].slot} then ${s.slot}`);
      }
    }

    // At most one lunch per day (dinner is not a slot, it's evening)
    assert.ok(lunchCount <= 1, `day ${dayIdx + 1}: found ${lunchCount} lunch slots, expected ≤1`);
  }
});

test('R1: minimal-detour lunch — far restaurant skipped, near restaurant scheduled', () => {
  const posts = [];
  // Two sights in a line (north)
  posts.push(P('north1', 37.60, 126.95, 'attraction'));
  posts.push(P('north2', 37.62, 126.95, 'attraction'));
  // Restaurants: one near the route (minimal detour), one far
  posts.push(P('rest_near', 37.61, 126.95, 'restaurant')); // On the line
  posts.push(P('rest_far', 37.60, 127.10, 'restaurant')); // 10+ km detour

  const it = buildItinerary(posts, { days: 1 });
  assert.equal(it.ok, true);
  const day = it.days[0];

  // Check lunch is either scheduled (near rest) or not (if detour > 2.5km)
  const lunch = day.stops.find((s) => s.slot === 'lunch');
  if (lunch) {
    assert.equal(lunch.slug, 'rest_near', 'lunch should be the near restaurant, not the far one');
  }
});

test('R2: HARD CONSTRAINT — ise-sueyoshi (evening-only kaiseki) never in lunch/morning', () => {
  // Real case: Tokyo ise-sueyoshi says "Evening dinner service is the standard time slot"
  const iseSueyoshi = {
    id: 'tokyo-ise-sueyoshi',
    data: {
      title: 'Ise Sueyoshi Kaiseki',
      category: 'restaurant',
      place: { lat: 35.6762, lng: 139.7674, businessStatus: 'OPERATIONAL' },
      tags: []
    },
    body: 'Evening dinner service is the standard time slot for this kind of kaiseki experience.'
  };

  assert.equal(preferredSlot(iseSueyoshi), 'evening', 'should recognize "Evening dinner service is standard"');

  // If this venue appears in an itinerary, it must be in evening slot only
  const posts = [];
  for (let i = 0; i < 6; i++) posts.push(P(`tokyo${i}`, 35.68, 139.77, 'attraction'));
  posts.push(iseSueyoshi);

  const it = buildItinerary(posts, { days: 2 });
  if (it.ok) {
    for (const day of it.days) {
      const found = day.stops.find((s) => s.slug === 'tokyo-ise-sueyoshi');
      if (found) {
        assert.equal(found.slot, 'evening', 'ise-sueyoshi must be evening, not ' + found.slot);
      }
    }
  }
});

test('R2: time-of-day slotting — evening venue never in lunch/morning, morning venue never in evening', () => {
  // Evening-preferring venue
  const eveningVenue = {
    id: 'evening-bar',
    data: {
      title: 'Night Bar',
      category: 'trendy',
      place: { lat: 37.58, lng: 126.97, businessStatus: 'OPERATIONAL' },
      tags: []
    },
    body: 'Bar-club energy, especially after 9pm. Evening dinner service is standard.'
  };

  // Morning-preferring venue
  const morningVenue = {
    id: 'morning-cafe',
    data: {
      title: 'Breakfast Cafe',
      category: 'restaurant',
      place: { lat: 37.59, lng: 126.98, businessStatus: 'OPERATIONAL' },
      tags: []
    },
    body: 'A breakfast-and-brunch spot perfect for mornings.'
  };

  // Test preferredSlot function
  assert.equal(preferredSlot(eveningVenue), 'evening');
  assert.equal(preferredSlot(morningVenue), 'morning');
});

test('R3: rain swaps from city-wide indoor posts, not just cluster', () => {
  // This is integration-level; buildItinerary should pick from all q, not just clusters
  // Build posts with one clear indoor venue not in first cluster
  const posts = [];
  for (let i = 0; i < 6; i++) posts.push(P(`north${i}`, 37.60, 126.95, 'attraction'));
  posts.push(P('museum', 37.50, 127.05, 'attraction')); // Far, but indoor-like
  const it = buildItinerary(posts, { days: 2 });
  assert.equal(it.ok, true);

  // At least one day should have a rainSwapSlug (the museum is unused and indoor)
  const hasRainSwap = it.days.some((d) => d.rainSwapSlug !== null);
  assert.ok(hasRainSwap || it.days.some((d) => d.stops.some((s) => s.slug === 'museum')), 'museum should be either a stop or a rain swap');
});

test('R4: ferry destination forces transit even at short distance', () => {
  const bangkok = { data: { place: { lat: 13.75, lng: 100.5 } } };
  const watArun = {
    data: {
      title: 'Wat Arun',
      place: { lat: 13.75, lng: 100.515 }
    },
    body: 'Cross the river by ferry from Tha Tien pier to reach this temple.'
  };

  const leg = walkLeg(bangkok, watArun);
  assert.equal(leg.transit, true, 'ferry destination should force transit:true');
  assert.equal(leg.minutes, null, 'ferry leg should have null minutes');
  assert.ok(leg.km >= 0.1, 'km should still be calculated');
});

// --- Backfill: a skipped lunch must never leave a short day -------------------
// Regression: planDay used to reserve a stop for lunch whenever the cluster held any
// restaurant. When the lunch was then skipped (detour too long, or a slot lock), the
// reserved capacity was simply lost and the day came out with 2 stops — and the guard
// added for that turned the whole city into ok:false. The freed slot must go back to
// sights instead.

test('backfill: only restaurant is far away → 3-stop day built from sights, no lunch', () => {
  // Three sights in a line plus one restaurant 5km off the route: the lunch detour is
  // way over 2.5km, so lunch is skipped and the freed capacity returns to the sights.
  const posts = [
    P('sight-a', 37.500, 127.100),
    P('sight-b', 37.502, 127.100),
    P('sight-c', 37.504, 127.100),
    P('far-restaurant', 37.500, 127.145, 'restaurant'),
  ];
  const it = buildItinerary(posts, { days: 1 });
  assert.equal(it.ok, true, `far restaurant must not fail the city: ${it.reason}`);
  const day = it.days[0];
  assert.equal(day.stops.length, 3, `expected a 3-stop day, got ${day.stops.length}: ${day.stops.map((s) => s.slug).join(',')}`);
  assert.equal(day.stops.find((s) => s.slot === 'lunch'), undefined, 'a 5km-detour restaurant must not be scheduled for lunch');
  assert.ok(!day.stops.some((s) => s.slug === 'far-restaurant'), 'the far restaurant must not appear at all');
  assert.deepEqual(day.stops.map((s) => s.slot), ['morning', 'afternoon', 'evening']);

  // Control: move the same restaurant onto the route and it IS scheduled — proving the
  // 3-stop day above comes from the detour rule, not from lunch being broken outright.
  const near = buildItinerary([...posts.slice(0, 3), P('near-restaurant', 37.502, 127.1005, 'restaurant')], { days: 1 });
  assert.equal(near.ok, true);
  assert.equal(near.days[0].stops.find((s) => s.slot === 'lunch')?.slug, 'near-restaurant');
});

test('backfill: a thin cluster is topped up from other days, never returned as ok:false', () => {
  // Cluster B holds only 2 sights + a restaurant too far to lunch at — exactly the shape
  // that produced "day 2 has only 2 stops" on real Seoul and Bangkok data. The solver
  // must pull the nearest spare sight in rather than fail, and must not starve the day
  // it borrowed from.
  const posts = [];
  for (let i = 0; i < 6; i++) posts.push(P(`a-sight${i}`, 37.60 + i * 0.002, 126.95));
  posts.push(P('b-sight0', 37.500, 127.100));
  posts.push(P('b-sight1', 37.502, 127.100));
  posts.push(P('b-far-restaurant', 37.500, 127.145, 'restaurant'));
  for (let i = 0; i < 3; i++) posts.push(P(`c-sight${i}`, 37.40 + i * 0.002, 126.80));

  const it = buildItinerary(posts, { days: 3 });
  assert.equal(it.ok, true, `thin cluster must be backfilled, not rejected: ${it.reason}`);
  assert.equal(it.days.length, 3);
  for (const [i, d] of it.days.entries()) {
    assert.ok(d.stops.length >= 3 && d.stops.length <= 5, `day ${i + 1} has ${d.stops.length} stops`);
  }
  const bDay = it.days.find((d) => d.stops.some((s) => s.slug === 'b-sight0'));
  assert.ok(bDay, 'b-sight0 must be scheduled somewhere');
  assert.equal(bDay.stops.length, 3, 'the thin day must be topped up to 3 stops');
  assert.ok(!bDay.stops.some((s) => s.slug === 'b-far-restaurant'), 'the far restaurant must not be used to pad the day');
  assert.equal(bDay.stops.find((s) => s.slot === 'lunch'), undefined);
  // Every stop is still unique across the whole trip.
  const all = it.days.flatMap((d) => d.stops.map((s) => s.slug));
  assert.equal(new Set(all).size, all.length);
});

test('backfill: ok:false only when nothing can be added within the day budget', () => {
  // Twelve sights that each eat 5 hours. Any third stop blows the 600-minute cap, so no
  // amount of moving posts around can build a legal day — this is the one case where
  // refusing to emit an itinerary is the honest answer.
  const posts = [];
  for (let i = 0; i < 12; i++) {
    posts.push({ ...P(`marathon${i}`, 37.50 + i * 0.01, 127.0), body: 'Plan on 5 hours here.' });
  }
  const it = buildItinerary(posts, { days: 3 });
  assert.equal(it.ok, false, 'a day that cannot legally hold 3 stops must not be emitted');
  assert.match(it.reason, /budget/i, `reason should name the budget, got: ${it.reason}`);
  assert.equal(it.days.length, 0);
});

// --- the 4h floor is the solver's problem, not just the validator's ----------

test('every emitted day clears DAY_MIN_MINUTES, even when 3 short stops satisfy MIN_STOPS', () => {
  // The new-york-3-days shape: one cluster of quick stops that reaches three
  // stops on count and stops ~30 min under the floor, plus a neighbouring
  // cluster with something to spare. The solver used to hand this straight to
  // the validator, which rejected it every night.
  const quick = (id, lat, lng) => ({ ...P(id, lat, lng), body: 'takes about 45 minutes' });
  const posts = [
    quick('c-short0', 37.400, 126.800),
    quick('c-short1', 37.402, 126.800),
    quick('c-short2', 37.404, 126.800),
    ...[0, 1, 2, 3, 4].map((i) => P(`a-sight${i}`, 37.600 + i * 0.002, 126.950)),
    ...[0, 1, 2, 3, 4].map((i) => P(`b-sight${i}`, 37.500 + i * 0.002, 127.100)),
  ];
  const it = buildItinerary(posts, { days: 3 });
  assert.equal(it.ok, true, `expected a buildable itinerary, got: ${it.reason}`);
  it.days.forEach((d, i) => {
    const total = d.stops.reduce((sum, s, si) => {
      const leg = s.walkToNext;
      return sum + s.dwellMin + (si < d.stops.length - 1 && leg ? (leg.transit ? 30 : leg.minutes ?? 0) : 0);
    }, 0);
    assert.ok(total >= DAY_MIN_MINUTES, `day ${i + 1} totals ${total} min, under the ${DAY_MIN_MINUTES} floor`);
  });
});

test('a day that cannot reach the 4h floor is refused, not emitted for the validator to reject', () => {
  // Twelve 45-minute stops in three tight clusters. Every day fills to the
  // 4-stop pace cap at 189 minutes, no day has a post to spare, and no amount
  // of moving them around makes four hours out of quarter-hours.
  const posts = [];
  for (const [c, lat] of [['a', 37.60], ['b', 37.50], ['c', 37.40]]) {
    for (let i = 0; i < 4; i++) posts.push({ ...P(`${c}-quick${i}`, lat + i * 0.002, 126.90), body: 'takes about 45 minutes' });
  }
  const it = buildItinerary(posts, { days: 3 });
  assert.equal(it.ok, false);
  assert.match(it.reason, /floor/i, `reason should name the floor, got: ${it.reason}`);
  assert.equal(it.days.length, 0);
});

test('backfill: identical input produces identical output (determinism)', () => {
  const build = () => {
    const posts = [];
    for (let i = 0; i < 6; i++) posts.push(P(`a-sight${i}`, 37.60 + i * 0.002, 126.95));
    posts.push(P('b-sight0', 37.500, 127.100));
    posts.push(P('b-sight1', 37.502, 127.100));
    posts.push(P('b-far-restaurant', 37.500, 127.145, 'restaurant'));
    for (let i = 0; i < 3; i++) posts.push(P(`c-sight${i}`, 37.40 + i * 0.002, 126.80));
    return JSON.stringify(buildItinerary(posts, { days: 3 }));
  };
  assert.equal(build(), build());
});

// --- preferredSlot is a lock, not a crowd-avoidance tip -----------------------

test('preferredSlot: crowd-timing prose is not a slot lock', () => {
  // Real guide sentences. Reading these as locks made almost every venue evening-only
  // and left no feasible plan at all — Seoul and Bangkok returned no itinerary.
  const sight = (body) => ({ id: 'x', data: { title: 'Some Palace', category: 'attraction', tags: [] }, body });
  assert.equal(preferredSlot(sight('Weekday mornings before 10am or evenings after dinner are calmest.')), null);
  assert.equal(preferredSlot(sight('Go early morning (before 9am) or in the evening to avoid the crowds.')), null);
  assert.equal(preferredSlot(sight('Joggers use the lower path at dawn and after 9pm, so keep to the side.')), null);
  assert.equal(preferredSlot(sight('Arrive early morning to beat the tour buses that build through late morning.')), null);
  // A nearby sushi-breakfast recommendation says nothing about THIS venue's hours.
  assert.equal(preferredSlot(sight('Toyosu Market and its sushi breakfast spots are a short ride away.')), null);
});

test('preferredSlot: reads the whole post, frontmatter FAQ included', () => {
  // bangkok-somsak keeps "bar-club energy, especially after 9pm" in an FAQ answer, not
  // in the body. A body-only read left it sitting in an afternoon slot.
  const somsak = {
    id: 'bangkok-somsak',
    data: {
      title: 'Somsak in Bangkok', category: 'trendy', tags: [],
      place: { lat: 13.7202, lng: 100.585, businessStatus: 'OPERATIONAL' },
      faq: [{ q: 'What is the vibe?', a: "Rather than quiet dining — expect a bar-club energy, especially after 9pm." }],
    },
    body: 'A buzzy, recently opened spot in Thonglor.',
  };
  assert.equal(preferredSlot(somsak), 'evening');
});

// --- dwellMinutes against the real published posts ---------------------------
// The extractor used to collapse these five to the 30-minute floor, because a guide
// mentions travel minutes ("a five-minute walk from Exit 5", "10-15 minutes from
// Bukchon") long before it says how long to stay. That shipped a Seoul itinerary
// claiming Gyeongbokgung Palace takes 30 minutes.
//
// These read the actual files: the geocode and photo pipelines rewrite frontmatter but
// not prose, and this is the exact defect a synthetic fixture failed to catch.

import { readFileSync, existsSync } from 'node:fs';
import yaml from 'js-yaml';

function loadPost(slug) {
  const path = new URL(`../content/posts/${slug}.md`, import.meta.url);
  const text = readFileSync(path, 'utf8');
  const end = text.indexOf('\n---', 3);
  return { id: slug, data: yaml.load(text.slice(4, end)), body: text.slice(end + 4) };
}

test('dwellMinutes: real launch-city posts, not the 30-minute floor', () => {
  const cases = [
    // slug,                             min, max, why
    ['seoul-gyeongbokgung-palace', 150, 150, 'body says "Plan on 2-3 hours"'],
    ['seoul-myeongdong-shopping-street', 150, 150, 'frontmatter says "Budget 2-3 hours"'],
    ['seoul-gwangjang-market', 90, 90, 'body says "Budget 1-2 hours" / "Plan on one to two hours"'],
    ['seoul-ikseon-dong', 100, 110, 'body says "Budget 1.5 to 2 hours"'],
    ['seoul-cheonggyecheon', 30, 60, '"takes 30-45 minutes"; must not read "the full 11 km ... 3+ hours"'],
  ];
  for (const [slug, min, max, why] of cases) {
    if (!existsSync(new URL(`../content/posts/${slug}.md`, import.meta.url))) continue;
    const got = dwellMinutes(loadPost(slug));
    assert.ok(got >= min && got <= max, `${slug}: expected ${min}-${max} (${why}), got ${got}`);
    assert.notEqual(got, 30, `${slug} collapsed to the 30-minute floor`);
  }
});

test('dwellMinutes: travel time never beats the visit recommendation', () => {
  // The literal shapes that used to win. Each pairs an access time with a real one.
  const d = (body) => dwellMinutes({ data: { category: 'attraction' }, body });
  assert.equal(d('Anyone coming from Bukchon can walk over in 10-15 minutes. Plan on 2-3 hours for the palace.'), 150);
  assert.equal(d('Take exit 6 and walk north about 3-5 minutes. Budget 1.5 to 2 hours for a relaxed wander.'), 105);
  assert.equal(d('The closest station is a 5-minute walk. Budget 1-2 hours and roughly 15,000 won.'), 90);
  // Word numbers.
  assert.equal(d('Plan on one to two hours to eat and browse.'), 90);
  assert.equal(d('Allow several hours if you are serious about it.'), 180);
  // "takes" is a weak signal: a strong recommendation later in the post still wins.
  assert.equal(d('This walk alone takes 15-20 minutes each way. Budget 60-90 minutes to walk the approach.'), 75);
  // ...but "takes" still works when it is the only duration given.
  assert.equal(d('A satisfying visit is the first stretch, which takes 30-45 minutes at an easy pace.'), 38);
});

test('dwellMinutes: a combined-outing duration is not this venue dwell', () => {
  // "close enough to combine into a half-day" was reading a lunch counter as 4 hours.
  const d = (body, category = 'restaurant') => dwellMinutes({ data: { category }, body });
  assert.equal(d('The museum a short taxi ride away is close enough to combine into a half-day.'), 60);
  assert.equal(d('Pair it with a walk along the nearby park for a full half-day itinerary.', 'trendy'), 90);
});
