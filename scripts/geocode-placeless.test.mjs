// Pure-logic + frontmatter round-trip tests for geocode-placeless.mjs.
// Run with: node --test scripts/geocode-placeless.test.mjs
// No network access — the Places API cannot be reached from this machine
// (known 403 on this IP), so these tests cover everything that doesn't
// require a live API call: title→query stripping, the confidence gate,
// and writing the `place:` block back into a real post file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';

import {
  titleMainPart,
  buildQuery,
  nameGatePass,
  evaluateGate,
  businessStatusOk,
  computeCentroid,
  buildCentroids,
  isTarget,
  buildPlaceBlock,
  insertPlaceIntoFrontmatter,
  writePostFile,
} from './geocode-placeless.mjs';

// ── title → query stripping ────────────────────────────────────────────

test('titleMainPart strips a trailing "in {region}"', () => {
  assert.equal(titleMainPart('Ikseon-Dong in Seoul', 'Seoul'), 'Ikseon-Dong');
  assert.equal(titleMainPart('London Bagel Museum in Seoul', 'Seoul'), 'London Bagel Museum');
  assert.equal(titleMainPart('Saladaeng in Bangkok', 'Bangkok'), 'Saladaeng');
  assert.equal(titleMainPart('Oxomoco in Tokyo', 'Tokyo'), 'Oxomoco');
});

test('titleMainPart leaves a title alone when there is no trailing "in {region}"', () => {
  assert.equal(titleMainPart('CAFE 3 STRIPES SEOUL', 'Seoul'), 'CAFE 3 STRIPES SEOUL');
  assert.equal(titleMainPart('StreetXO Ibiza', 'Ibiza'), 'StreetXO Ibiza');
});

test('titleMainPart strips wrapping quote characters', () => {
  assert.equal(titleMainPart(`'Saladaeng in Bangkok'`, 'Bangkok'), 'Saladaeng');
  assert.equal(titleMainPart(`"Ikseon-Dong in Seoul"`, 'Seoul'), 'Ikseon-Dong');
});

test('buildQuery appends the region to the stripped title', () => {
  assert.equal(buildQuery('Ikseon-Dong in Seoul', 'Seoul'), 'Ikseon-Dong Seoul');
});

// ── gate (b): name token overlap ───────────────────────────────────────

test('nameGatePass accepts "Ikseon-Dong in Seoul" vs result displayName "Ikseon-dong" (hyphen/space-insensitive)', () => {
  const tmp = titleMainPart('Ikseon-Dong in Seoul', 'Seoul');
  assert.equal(nameGatePass(tmp, 'Seoul', 'Ikseon-dong'), true);
});

test('nameGatePass rejects an unrelated venue name', () => {
  const tmp = titleMainPart('Ikseon-Dong in Seoul', 'Seoul');
  assert.equal(nameGatePass(tmp, 'Seoul', 'Bukchon Hanok Village'), false);
});

// ── gate (a)+(b) combined: the Oxomoco Brooklyn trap ────────────────────

test('evaluateGate rejects "Oxomoco in Tokyo" matched to the Brooklyn NY restaurant via gate (a), even though the name matches', () => {
  const tmp = titleMainPart('Oxomoco in Tokyo', 'Tokyo');
  const result = {
    id: 'fake-brooklyn-id',
    name: 'Oxomoco',
    address: 'Brooklyn, NY, USA',
    lat: 40.7223,
    lng: -73.9490,
    businessStatus: 'OPERATIONAL',
  };
  // Name gate alone would pass (exact same name) — the point of this test is
  // that the CITY gate must catch it first.
  assert.equal(nameGatePass(tmp, 'Tokyo', result.name), true);

  const centroid = { lat: 35.6762, lng: 139.6503 }; // Tokyo
  const gate = evaluateGate({ titleMainPart: tmp, region: 'Tokyo', result, centroid });
  assert.equal(gate.pass, false);
  assert.match(gate.reason, /city mismatch/i);
});

test('evaluateGate accepts a real Tokyo match within the address AND the radius', () => {
  const tmp = titleMainPart('Oxomoco in Tokyo', 'Tokyo');
  const result = {
    id: 'fake-tokyo-id',
    name: 'Oxomoco',
    address: '1 Chome Shibuya, Tokyo 150-0002, Japan',
    lat: 35.66,
    lng: 139.7,
    businessStatus: 'OPERATIONAL',
  };
  const centroid = { lat: 35.6762, lng: 139.6503 };
  const gate = evaluateGate({ titleMainPart: tmp, region: 'Tokyo', result, centroid });
  assert.equal(gate.pass, true);
});

test('evaluateGate falls back to address-only matching when a region has no centroid', () => {
  const tmp = titleMainPart('Somewhere in Nowhereville', 'Nowhereville');
  const inAddress = {
    id: 'x', name: 'Somewhere', address: '123 Main St, Nowhereville', lat: 1, lng: 1,
  };
  const notInAddress = {
    id: 'y', name: 'Somewhere', address: '123 Main St, Faraway City', lat: 1, lng: 1,
  };
  assert.equal(evaluateGate({ titleMainPart: tmp, region: 'Nowhereville', result: inAddress, centroid: null }).pass, true);
  assert.equal(evaluateGate({ titleMainPart: tmp, region: 'Nowhereville', result: notInAddress, centroid: null }).pass, false);
});

test('evaluateGate rejects a CLOSED business even when city and name match', () => {
  const tmp = titleMainPart('Saladaeng in Bangkok', 'Bangkok');
  const result = {
    id: 'z', name: 'Saladaeng', address: 'Bangkok, Thailand', lat: 13.72, lng: 100.53,
    businessStatus: 'CLOSED_PERMANENTLY',
  };
  const gate = evaluateGate({ titleMainPart: tmp, region: 'Bangkok', result, centroid: null });
  assert.equal(gate.pass, false);
  assert.match(gate.reason, /closed/i);
});

test('businessStatusOk treats a missing status as passing', () => {
  assert.equal(businessStatusOk(undefined), true);
  assert.equal(businessStatusOk('OPERATIONAL'), true);
  assert.equal(businessStatusOk('CLOSED_TEMPORARILY'), false);
  assert.equal(businessStatusOk('CLOSED_PERMANENTLY'), false);
});

// ── centroid math ───────────────────────────────────────────────────────

test('computeCentroid averages lat/lng and returns null for an empty list', () => {
  assert.equal(computeCentroid([]), null);
  const c = computeCentroid([{ lat: 10, lng: 20 }, { lat: 20, lng: 40 }]);
  assert.equal(c.lat, 15);
  assert.equal(c.lng, 30);
});

test('buildCentroids groups by region and ignores draft posts / posts without coords', () => {
  const posts = [
    { fm: { region: 'Seoul', place: { lat: 37.5, lng: 127.0 } } },
    { fm: { region: 'Seoul', place: { lat: 37.6, lng: 127.1 } } },
    { fm: { region: 'Seoul', draft: true, place: { lat: 99, lng: 99 } } }, // excluded (draft)
    { fm: { region: 'Tokyo' } }, // excluded (no place)
  ];
  const centroids = buildCentroids(posts);
  assert.ok(centroids.has('Seoul'));
  assert.equal(centroids.get('Seoul').lat, 37.55);
  assert.equal(centroids.has('Tokyo'), false);
});

// ── target selection ────────────────────────────────────────────────────

test('isTarget selects only non-draft, non-event posts without a place block', () => {
  assert.equal(isTarget({ category: 'restaurant' }), true);
  assert.equal(isTarget({ category: 'restaurant', place: { id: 'x' } }), false);
  assert.equal(isTarget({ category: 'restaurant', draft: true }), false);
  assert.equal(isTarget({ category: 'event' }), false);
});

// ── place block shape ───────────────────────────────────────────────────

test('buildPlaceBlock only includes rating/userRatingsTotal/businessStatus when present', () => {
  const full = buildPlaceBlock({
    id: 'abc', name: 'Test Venue', address: '1 Test St',
    rating: 4.5, userRatingsTotal: 100, googleMapsUrl: 'https://maps.google.com/?cid=1',
    businessStatus: 'OPERATIONAL', lat: 1.23, lng: 4.56,
  });
  assert.deepEqual(Object.keys(full), ['id', 'name', 'address', 'rating', 'userRatingsTotal', 'googleMapsUrl', 'businessStatus', 'lat', 'lng']);

  const minimal = buildPlaceBlock({
    id: 'abc', name: 'Test Venue', address: '1 Test St',
    googleMapsUrl: 'https://maps.google.com/?cid=1', lat: 1.23, lng: 4.56,
  });
  assert.deepEqual(Object.keys(minimal), ['id', 'name', 'address', 'googleMapsUrl', 'lat', 'lng']);
});

test('insertPlaceIntoFrontmatter inserts place right after gallery, preserving all other keys/order', () => {
  const fm = { title: 'X', region: 'Seoul', heroImage: { url: 'u' }, gallery: [], tags: ['a'], draft: false };
  const place = { id: '1', name: 'X', address: 'addr', googleMapsUrl: 'g', lat: 1, lng: 2 };
  const out = insertPlaceIntoFrontmatter(fm, place);
  assert.deepEqual(Object.keys(out), ['title', 'region', 'heroImage', 'gallery', 'place', 'tags', 'draft']);
  assert.deepEqual(out.place, place);
  // original object untouched
  assert.equal('place' in fm, false);
});

// ── frontmatter round-trip write (real fixture, temp copy) ─────────────

test('writePostFile writes a place: block and leaves every other field + the body untouched', async () => {
  const fixturePath = new URL('../src/content/posts/seoul-ikseon-dong.md', import.meta.url);
  const original = await readFile(fixturePath, 'utf8');

  const dir = await mkdtemp(join(tmpdir(), 'geocode-placeless-test-'));
  const tmpPath = join(dir, 'seoul-ikseon-dong.md');
  await writeFile(tmpPath, original, 'utf8');

  try {
    const before = matter(original);
    assert.equal(before.data.place, undefined, 'fixture must start placeless for this test to be meaningful');

    const place = buildPlaceBlock({
      id: 'ChIJ-fake-ikseon-dong',
      name: 'Ikseon-dong',
      address: 'Ikseon-dong, Jongno-gu, Seoul, South Korea',
      rating: 4.4,
      userRatingsTotal: 2100,
      googleMapsUrl: 'https://maps.google.com/?cid=1234567890',
      businessStatus: 'OPERATIONAL',
      lat: 37.5735,
      lng: 126.9910,
    });
    const nextFm = insertPlaceIntoFrontmatter(before.data, place);
    await writePostFile(tmpPath, nextFm, before.content, original);

    const rewritten = await readFile(tmpPath, 'utf8');
    const after = matter(rewritten);

    // place block landed with the right values
    assert.deepEqual(after.data.place, place);

    // every other frontmatter field is untouched
    for (const key of Object.keys(before.data)) {
      assert.deepEqual(after.data[key], before.data[key], `field "${key}" changed`);
    }

    // body/prose is byte-for-byte identical — round-trip must never touch it
    assert.equal(after.content, before.content);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── line-ending preservation (backfill-place-details.mjs pattern) ──────

test('writePostFile normalizes the WHOLE output to CRLF when the source file is CRLF (no mixed line endings)', async () => {
  const fixturePath = new URL('../src/content/posts/seoul-ikseon-dong.md', import.meta.url);
  const original = await readFile(fixturePath, 'utf8');
  assert.ok(original.includes('\r\n'), 'fixture must be CRLF for this test to be meaningful');

  const dir = await mkdtemp(join(tmpdir(), 'geocode-placeless-test-'));
  const tmpPath = join(dir, 'crlf-fixture.md');
  await writeFile(tmpPath, original, 'utf8');

  try {
    const before = matter(original);
    const place = buildPlaceBlock({
      id: 'ChIJ-fake', name: 'Ikseon-dong', address: 'Seoul, South Korea',
      googleMapsUrl: 'https://maps.google.com/?cid=1', lat: 37.57, lng: 126.99,
    });
    const nextFm = insertPlaceIntoFrontmatter(before.data, place);
    await writePostFile(tmpPath, nextFm, before.content, original);

    const rewritten = await readFile(tmpPath, 'utf8');
    assert.ok(rewritten.includes('\r\n'), 'expected CRLF line endings in the output');
    // No bare LF anywhere — every \n must be preceded by \r.
    assert.equal(/(?<!\r)\n/.test(rewritten), false, 'found a bare LF in what should be an all-CRLF file');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writePostFile stays all-LF when the source file is LF-only (no mixed line endings)', async () => {
  const lfRaw =
    '---\n' +
    'title: LF Test Post\n' +
    'region: Testland\n' +
    'category: restaurant\n' +
    'heroImage:\n' +
    '  url: https://example.com/x.jpg\n' +
    'gallery: []\n' +
    'draft: false\n' +
    '---\n' +
    '\n' +
    '## Why go\n' +
    '\n' +
    'Some LF-only prose that must survive untouched.\n';
  assert.equal(lfRaw.includes('\r'), false, 'fixture must be LF-only for this test to be meaningful');

  const dir = await mkdtemp(join(tmpdir(), 'geocode-placeless-test-'));
  const tmpPath = join(dir, 'lf-fixture.md');
  await writeFile(tmpPath, lfRaw, 'utf8');

  try {
    const before = matter(lfRaw);
    const place = buildPlaceBlock({
      id: 'ChIJ-fake-lf', name: 'LF Test Post', address: 'Testland',
      googleMapsUrl: 'https://maps.google.com/?cid=2', lat: 1.23, lng: 4.56,
    });
    const nextFm = insertPlaceIntoFrontmatter(before.data, place);
    await writePostFile(tmpPath, nextFm, before.content, lfRaw);

    const rewritten = await readFile(tmpPath, 'utf8');
    assert.equal(rewritten.includes('\r'), false, 'found a CR in what should be an all-LF file');
    const after = matter(rewritten);
    assert.deepEqual(after.data.place, place);
    assert.equal(after.content, before.content);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
