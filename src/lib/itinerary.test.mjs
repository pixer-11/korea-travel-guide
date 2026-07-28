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
