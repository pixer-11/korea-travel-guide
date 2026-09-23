import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bestMonths, eventCounts, citiesByGuideCount, topVenues, pickHubHero } from './dest-hub.mjs';
import { monthComfort } from './when-to-go.mjs';

const facts = JSON.parse(readFileSync(new URL('../../data/country-facts.json', import.meta.url), 'utf8'));
const all = facts.countries ?? facts;

test('best months come from the when-to-go ranking, never a typed-in guess', () => {
  for (const [name, f] of Object.entries(all)) {
    const ms = bestMonths(f.climate);
    if ((f.climate ?? []).length !== 12) {
      assert.deepEqual(ms, [], `${name}: no climate record must mean no months`);
      continue;
    }
    assert.ok(ms.length >= 1 && ms.length <= 2, `${name}: ${ms}`);
    const ranked = [...monthComfort(f.climate)].sort((a, b) => a.score - b.score);
    // The winner of monthComfort is always shown.
    assert.ok(ms.includes(ranked[0].m), `${name}: best month ${ranked[0].m} missing from ${ms}`);
    for (const m of ms) assert.ok(m >= 1 && m <= 12);
  }
});

test('no climate record → no best-months cell', () => {
  assert.deepEqual(bestMonths(undefined), []);
  assert.deepEqual(bestMonths([{ m: 1, hi: 10, lo: 1, rain: 5 }]), []);
});

test('the runner-up month is dropped when it is a worse band than the winner', () => {
  // One perfect month, eleven hot and wet ones.
  const climate = Array.from({ length: 12 }, (_, i) =>
    i === 4 ? { m: 5, hi: 22, lo: 14, rain: 10 } : { m: i + 1, hi: 38, lo: 28, rain: 400 - i });
  assert.deepEqual(bestMonths(climate), [5]);
});

test('December and January read Dec · Jan', () => {
  const climate = Array.from({ length: 12 }, (_, i) =>
    i === 0 || i === 11 ? { m: i + 1, hi: 22, lo: 14, rain: 10 } : { m: i + 1, hi: 38, lo: 28, rain: 400 });
  assert.deepEqual(bestMonths(climate), [12, 1]);
});

const ev = (start, end) => ({ data: { category: 'event', eventStartDate: start, eventEndDate: end } });

test('event counts: ended events drop out, running ones count this month', () => {
  const today = new Date('2026-09-24T03:00:00Z');
  const posts = [
    ev('2026-09-01', '2026-09-10'), // over
    ev('2026-09-20', '2026-09-30'), // running now
    ev('2026-09-24', '2026-09-24'), // today
    ev('2026-09-30', '2026-10-02'), // starts in the last day of the month
    ev('2026-10-01', '2026-10-05'), // next month
    ev(undefined, undefined), // undated — upcoming, but not "this month"
    { data: { category: 'attraction' } },
  ];
  assert.deepEqual(eventCounts(posts, today), { upcoming: 5, thisMonth: 3 });
});

test('cities rank by guide count, ties alphabetical', () => {
  const p = (region) => ({ data: { region, category: 'attraction' } });
  const r = citiesByGuideCount([p('Osaka'), p('Tokyo'), p('Tokyo'), p('Kyoto'), p('Osaka'), p('Tokyo')]);
  assert.deepEqual(r, [
    { region: 'Tokyo', count: 3 },
    { region: 'Osaka', count: 2 },
    { region: 'Kyoto', count: 1 },
  ]);
});

test('top venues skip events and prefer review volume', () => {
  const v = (id, cat, n) => ({ id, data: { region: 'Tokyo', category: cat, place: { userRatingsTotal: n } } });
  const r = topVenues([v('a', 'attraction', 10), v('b', 'event', 99999), v('c', 'restaurant', 500), v('d', 'trendy', 50)], 'Tokyo', 2);
  assert.deepEqual(r.map((x) => x.id), ['c', 'd']);
});

const hero = (id, cat, url, license = 'wikimedia', reviews = 0) =>
  ({ id, data: { category: cat, heroImage: { url, license }, place: { userRatingsTotal: reviews } } });

test('hero never uses an event, stock or placeholder photo', () => {
  const posts = [
    hero('concert', 'event', 'https://x/concert.jpg'),
    hero('stock', 'attraction', 'https://x/stock.jpg', 'unsplash'),
    hero('ph', 'attraction', 'https://x/placeholder.jpg', 'placeholder'),
  ];
  assert.equal(pickHubHero(posts), null);
});

test('hero prefers a proven-wide landmark, then the most reviewed', () => {
  const widths = { narrow: 640, wide: 1600, cafe: 2000 };
  const widthOf = (p) => widths[p.id] ?? null;
  const posts = [
    hero('narrow', 'attraction', 'https://x/n.jpg', 'wikimedia', 99999), // <800px: out
    hero('unknown', 'attraction', 'https://x/u.jpg', 'wikimedia', 5000),
    hero('cafe', 'trendy', 'https://x/c.jpg', 'foursquare', 100),
    hero('wide', 'attraction', 'https://x/w.jpg', 'wikimedia', 10),
  ];
  assert.equal(pickHubHero(posts, widthOf).id, 'wide');
  assert.equal(pickHubHero(posts.filter((p) => p.id !== 'wide' && p.id !== 'cafe'), widthOf).id, 'unknown');
});

test('hubHeroForDay rotates through landmark photos, one per day', async () => {
  const { hubHeroForDay, hubHeroCandidates } = await import('./dest-hub.mjs');
  const mk = (id, category, reviews) => ({ id, data: { category, heroImage: { url: `https://x/${id}.jpg`, license: 'cc-by' }, place: { userRatingsTotal: reviews } } });
  const posts = [mk('a', 'attraction', 900), mk('b', 'attraction', 800), mk('c', 'restaurant', 99999), mk('e', 'event', 1)];
  const cands = hubHeroCandidates(posts);
  assert.deepEqual(cands.map((p) => p.id), ['a', 'b'], 'landmarks only, restaurant and event left out');
  const d0 = hubHeroForDay(posts, () => null, new Date('2026-09-24T00:00:00Z')).id;
  const d1 = hubHeroForDay(posts, () => null, new Date('2026-09-25T00:00:00Z')).id;
  assert.notEqual(d0, d1, 'consecutive days show different photos');
  assert.equal(hubHeroForDay([mk('e', 'event', 1)]), null);
});
