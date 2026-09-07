import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { hubPathsFor, dayTripHubDates } from './hub-lastmod.mjs';
import { computeDayTrips } from './dayTrips.mjs';
import { slugifyRegion } from './slug.ts';

// The three hub families that had no freshness signal at all until 2026-09-07:
// /continents/, /day-trips/ and the six /essentials/ topic pages. 37 English
// URLs — 185 across five languages — were submitted to Google with no <lastmod>,
// not because a slug was wrong but because nothing emitted them in the first
// place.

// ── /continents/<c> ───────────────────────────────────────────────────────────
// The page is a grid of the continent's countries WITH THEIR POST COUNTS, so a
// new guide anywhere on it genuinely changes the page.

test('a guide freshens its continent hub', () => {
  assert.ok(hubPathsFor({ region: 'Kyoto', country: 'Japan' }).includes('/continents/asia'));
  assert.ok(hubPathsFor({ region: 'Florence', country: 'Italy' }).includes('/continents/europe'));
  assert.ok(hubPathsFor({ region: 'Austin', country: 'United States' }).includes('/continents/north-america'));
});

test('a guide freshens ONE continent, not all of them', () => {
  const paths = hubPathsFor({ region: 'Kyoto', country: 'Japan' }).filter((p) => p.startsWith('/continents/'));
  assert.deepEqual(paths, ['/continents/asia']);
});

test('a country nobody has mapped to a continent gets no continent hub', () => {
  // countries.json is the route's own source; a country missing from it has no
  // /continents/ page to freshen, and inventing one would be a dead key again.
  const paths = hubPathsFor({ region: 'Nowhere', country: 'Atlantis' });
  assert.equal(paths.some((p) => p.startsWith('/continents/')), false);
});

// ── /day-trips/<city> ─────────────────────────────────────────────────────────
// The page shows the ANCHOR's neighbours' guides and none of the anchor's own,
// so no per-post rule can reach it — the date has to come from the graph.

const post = (id, region, lastmod, extra = {}) => ({
  id,
  data: { region, country: 'Japan', category: 'attraction', lastmod, pubDate: new Date(lastmod), ...extra },
});

test('a day-trip hub takes the newest date among the cards it renders', () => {
  const fakeHubs = () => [{
    slug: 'kyoto',
    neighbors: [
      { region: 'Nara', posts: [post('a', 'Nara', '2026-08-01'), post('b', 'Nara', '2026-08-20')] },
      { region: 'Osaka', posts: [post('c', 'Osaka', '2026-07-15')] },
    ],
  }];
  const dates = dayTripHubDates([], fakeHubs);
  assert.equal(dates.get('/day-trips/kyoto'), '2026-08-20');
});

test('a guide the hub does NOT render cannot re-date it', () => {
  // computeDayTrips slices each neighbour to six cards. The seventh guide in
  // Nara changes nothing on /day-trips/kyoto/, and claiming it did is the exact
  // lie this module was written to stop telling.
  const shown = post('shown', 'Nara', '2026-08-01');
  const hidden = post('hidden', 'Nara', '2026-09-30');
  const fakeHubs = () => [{ slug: 'kyoto', neighbors: [{ region: 'Nara', posts: [shown] }] }];
  const dates = dayTripHubDates([hidden, shown], fakeHubs);
  assert.equal(dates.get('/day-trips/kyoto'), '2026-08-01');
});

test('a hub whose cards carry no date gets no lastmod rather than a made-up one', () => {
  const fakeHubs = () => [{ slug: 'kyoto', neighbors: [{ region: 'Nara', posts: [post('a', 'Nara', undefined)] }] }];
  assert.equal(dayTripHubDates([], fakeHubs).has('/day-trips/kyoto'), false);
});

test('the real corpus dates every day-trip hub the real graph builds', () => {
  const dir = new URL('../content/posts/', import.meta.url);
  const posts = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const raw = readFileSync(new URL(f, dir), 'utf8');
    const end = raw.replace(/\r\n/g, '\n').indexOf('\n---', 3);
    if (end < 0) continue;
    const fm = raw.replace(/\r\n/g, '\n').slice(4, end);
    if (/^draft:\s*true/m.test(fm)) continue;
    const val = (k) => {
      const line = fm.split('\n').find((l) => l.startsWith(k + ':'));
      return line ? line.slice(k.length + 1).trim().replace(/^["']|["']$/g, '') : '';
    };
    const num = (k) => {
      const m = new RegExp(`^\\s+${k}:\\s*(-?[0-9.]+)\\s*$`, 'm').exec(fm);
      return m ? Number(m[1]) : undefined;
    };
    const lat = num('lat'), lng = num('lng');
    const date = (val('updatedDate') || val('pubDate') || '').slice(0, 10);
    posts.push({
      id: f.replace(/\.md$/, ''),
      data: {
        region: val('region'),
        country: val('country') || 'South Korea',
        category: val('category'),
        place: lat !== undefined && lng !== undefined ? { lat, lng } : undefined,
        pubDate: new Date(val('pubDate')),
        lastmod: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
      },
    });
  }
  assert.ok(posts.length > 1000, `expected the real corpus, found ${posts.length}`);

  const hubs = computeDayTrips(posts);
  assert.ok(hubs.length > 10, `expected real day-trip hubs, found ${hubs.length}`);
  const dates = dayTripHubDates(posts, computeDayTrips);

  // Every hub the route builds gets a date, and its slug is the routes' slug.
  for (const hub of hubs) {
    assert.equal(hub.slug, slugifyRegion(hub.city), `${hub.city} slug`);
    assert.ok(dates.has(`/day-trips/${hub.slug}`), `/day-trips/${hub.slug} has no date`);
  }
  // And nothing is dated that no hub exists for.
  const built = new Set(hubs.map((h) => `/day-trips/${h.slug}`));
  for (const path of dates.keys()) assert.ok(built.has(path), `${path} is dated but not built`);
});

// ── /essentials/<topic> ───────────────────────────────────────────────────────
// Nothing dated lives beneath these six, so their own lastReviewed is the only
// honest date they can have. Required by the schema; asserted here too, because
// the schema failure would only surface on a 50-minute build.

test('every essentials topic carries the lastReviewed its sitemap entry needs', () => {
  const dir = new URL('../content/essentials-topics/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  assert.ok(files.length >= 6, `expected the topic hubs, found ${files.length}`);
  for (const f of files) {
    const fm = readFileSync(new URL(f, dir), 'utf8').split('---')[1] ?? '';
    const m = /(?:^|\n)lastReviewed:\s*['"]?(\d{4}-\d{2}-\d{2})/.exec(fm);
    assert.ok(m, `${f} has no lastReviewed — its hub would be submitted with no date`);
  }
});
