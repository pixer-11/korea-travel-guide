import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDayTrips } from './dayTrips.mjs';

// Kyoto at (35.0, 135.0); Nara ~55 km north; Osaka ~55 km east. Both are inside
// NEAR_KM (140) and outside the 8 km "same urban area" floor.
const AT = { kyoto: [35.0, 135.0], nara: [35.5, 135.0], osaka: [35.0, 135.6] };

const post = (id, region, pubDate, category = 'attraction') => ({
  id,
  data: {
    region,
    country: 'Japan',
    category,
    pubDate,
    place: { lat: AT[region.toLowerCase()][0], lng: AT[region.toLowerCase()][1] },
  },
});

// Six anchor guides (MIN_ANCHOR_POSTS) and three in Osaka (MIN_NEIGHBOR_POSTS),
// which is the second neighbour MIN_NEIGHBORS needs. Each test supplies Nara's
// guides, so the only thing under test is what Nara contributes.
const scaffold = (nara) => [
  ...[1, 2, 3, 4, 5, 6].map((n) => post(`kyoto-${n}`, 'Kyoto', `2026-03-0${n}T00:00:00.000Z`)),
  ...[1, 2, 3].map((n) => post(`osaka-${n}`, 'Osaka', `2026-03-0${n}T00:00:00.000Z`)),
  ...nara,
];
const plainNara = [1, 2, 3].map((n) => post(`nara-${n}`, 'Nara', `2026-02-0${n}T00:00:00.000Z`));

const kyotoNeighbor = (posts, region) =>
  computeDayTrips(posts).find((h) => h.slug === 'kyoto')?.neighbors.find((n) => n.region === region);

test('the hubs and their gates still hold', () => {
  const hubs = computeDayTrips(scaffold(plainNara));
  const kyoto = hubs.find((h) => h.slug === 'kyoto');
  assert.ok(kyoto, 'Kyoto has 6 guides and two qualifying neighbours');
  assert.equal(kyoto.neighbors.length, 2);
  // Nara and Osaka have 3 guides each — under MIN_ANCHOR_POSTS, so no hub of
  // their own, and Kyoto's own guides never appear on Kyoto's page.
  assert.deepEqual(hubs.map((h) => h.slug), ['kyoto']);
  assert.equal(kyoto.neighbors.some((n) => n.region === 'Kyoto'), false);
});

// The regression this file exists for. z.coerce.date() makes pubDate a Date, and
// YAML gives a Date for a bare `pubDate: 2026-01-04` and a string for a quoted
// one. The tie-break used to be String(pubDate).localeCompare — "Sun Jan 04
// 2026…" against "2026-07-01T…", so it ordered by the ENGLISH NAME OF THE
// WEEKDAY and the oldest guide in the group sorted first. 26 of 27 live hubs
// were mis-ordered and ten cards showed a guide that should not have been there
// (measured 2026-09-07).
test('neighbour cards are newest first, whichever way the date was written', () => {
  const posts = scaffold([
    // Oldest of the seven, written bare — the one the old key put FIRST.
    post('nara-jan', 'Nara', new Date('2026-01-04T00:00:00Z')),
    ...['02', '03', '04', '05', '06', '07'].map((m) => post(`nara-${m}`, 'Nara', `2026-${m}-01T00:00:00.000Z`)),
  ]);
  const nara = kyotoNeighbor(posts, 'Nara');
  assert.ok(nara, 'Nara is a neighbour');
  assert.deepEqual(
    nara.posts.map((p) => p.id),
    ['nara-07', 'nara-06', 'nara-05', 'nara-04', 'nara-03', 'nara-02'],
    'newest six, newest first',
  );
  assert.equal(nara.posts.some((p) => p.id === 'nara-jan'), false, 'the oldest guide is not on the page');
  assert.equal(nara.total, 7, 'total still counts every guide in the region');
});

test('category rank still outranks the date', () => {
  const posts = scaffold([
    post('nara-old-attraction', 'Nara', '2026-01-01T00:00:00.000Z', 'attraction'),
    post('nara-new-restaurant', 'Nara', '2026-09-01T00:00:00.000Z', 'restaurant'),
    post('nara-mid-hidden', 'Nara', '2026-05-01T00:00:00.000Z', 'hidden-gem'),
  ]);
  const nara = kyotoNeighbor(posts, 'Nara');
  assert.deepEqual(nara.posts.map((p) => p.id), ['nara-old-attraction', 'nara-mid-hidden', 'nara-new-restaurant']);
});
