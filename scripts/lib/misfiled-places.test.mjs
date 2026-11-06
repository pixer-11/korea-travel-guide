// The 2026-11-06 class: a venue far from the searched town, written there anyway.
import test from 'node:test';
import assert from 'node:assert/strict';
import { farFromRegion } from './region-outlier.mjs';
import { regionDisowned } from './region-posts.mjs';
import { addMisfiled, barredRegions, readMisfiled } from './misfiled-places.mjs';

const live = (region, lat, lng, country = 'New Zealand') => ({ country, region, lat, lng, draft: false });
// Real centres: Franz Josef had one guide; Puerto Iguazú five, San Ignacio 206 km out.
const NZ = [live('Franz Josef', -43.389, 170.183), live('Wellington', -41.29, 174.78), live('Wellington', -41.28, 174.77)];
const AR = [0, 1, 2, 3, 4].map((i) => live('Puerto Iguazu', -25.6 + i * 0.01, -54.57, 'Argentina'));

test('a venue 374 km from the only guide of its searched town is not written there', () => {
  const omaka = { lat: -41.53, lng: 173.92 };
  assert.ok(farFromRegion(omaka, { country: 'New Zealand', region: 'Franz Josef' }, NZ) > 300);
});

test('the longest day trip on the site stays writable', () => {
  const sanIgnacio = { lat: -27.255, lng: -55.532 };
  assert.equal(farFromRegion(sanIgnacio, { country: 'Argentina', region: 'Puerto Iguazu' }, AR), null);
});

test('nothing to measure against, nothing decided', () => {
  const omaka = { lat: -41.53, lng: 173.92 };
  assert.equal(farFromRegion(omaka, { country: 'New Zealand', region: 'Blenheim' }, NZ), null, 'no guide there yet');
  assert.equal(farFromRegion({}, { country: 'New Zealand', region: 'Franz Josef' }, NZ), null, 'no coordinates');
  assert.equal(farFromRegion(omaka, { country: 'New Zealand', region: 'New Zealand' }, NZ), null, 'the country label');
  const drafts = NZ.map((p) => ({ ...p, draft: true }));
  assert.equal(farFromRegion(omaka, { country: 'New Zealand', region: 'Franz Josef' }, drafts), null, 'held drafts are no evidence');
});

const md = (region, body, name = 'Omaka Aviation Heritage Centre') => `---
title: "${name}: ${region} Travel Guide"
country: "New Zealand"
region: "${region}"
description: "A guide."
place:
  id: "ChIJrWs0PrRsOW0RyBbM8kER9tI"
  name: "${name}"
---
${body}
`;

test('the guide that says it is not in its region is caught before it is written', () => {
  const d = regionDisowned(md('Franz Josef', 'The Omaka Aviation Heritage Centre is not in Franz Josef. It sits at Omaka Aerodrome outside Blenheim.'));
  assert.equal(d.region, 'Franz Josef');
  assert.equal(d.placeId, 'ChIJrWs0PrRsOW0RyBbM8kER9tI');
  assert.equal(d.country, 'New Zealand');
  assert.match(d.excerpt, /not in Franz Josef/);
});

test('an honest guide is written', () => {
  assert.equal(regionDisowned(md('Blenheim', 'The centre sits at Omaka Aerodrome, a short drive from Blenheim.')), null);
  // A metro-area note is not a denial (regionExcuse's own exemption).
  assert.equal(regionDisowned(md('Seattle', 'It is in Bellevue, not in Seattle proper, across the lake.', 'Bellevue Arts Museum')), null);
  assert.equal(regionDisowned('not front matter at all'), null);
});

test('the ledger bars a venue from the wrong region only, and keeps every verdict', () => {
  let s = readMisfiled(new URL('file:///nonexistent/misfiled.json'));
  assert.deepEqual(s.places, {});
  s = addMisfiled(s, { placeId: 'A', name: 'Mtirala National Park', country: 'Georgia', region: 'Akhaltsikhe', why: 'x', date: '2026-11-06' });
  s = addMisfiled(s, { placeId: 'A', region: 'Tskaltubo' });
  s = addMisfiled(s, { placeId: 'A', region: 'Akhaltsikhe' });
  assert.deepEqual(s.places.A.regions, ['Akhaltsikhe', 'Tskaltubo']);
  assert.equal(s.places.A.name, 'Mtirala National Park', 'a later verdict keeps the first record');
  const barred = barredRegions(s);
  assert.equal(barred.get('A').has('Akhaltsikhe'), true);
  assert.equal(barred.get('A').has('Batumi'), false, 'still writable where it belongs');
  assert.equal(addMisfiled(s, { placeId: '', region: 'X' }), s, 'nothing to record');
});

test('"listed under X, but" about something other than where it is drops nothing (Codex 11-06)', () => {
  assert.equal(regionDisowned(md('Seattle', 'The Seattle Art Museum is listed under Seattle, but its permanent collection focuses on art from around the world.', 'Seattle Art Museum')), null);
  assert.ok(regionDisowned(md('Lake Tekapo', 'Steampunk HQ is filed under Lake Tekapo, but it sits on the coast at Oamaru.', 'Steampunk HQ')));
});
