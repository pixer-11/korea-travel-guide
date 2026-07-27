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
