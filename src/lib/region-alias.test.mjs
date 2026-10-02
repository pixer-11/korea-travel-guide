import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGION_ALIAS, REGION_CANONICAL_NAME, canonicalRegion } from './region-alias.mjs';

test('an alias-source region is retagged to the canonical city', () => {
  assert.equal(canonicalRegion('Quezon City'), 'Manila');
  assert.equal(canonicalRegion('Goyang-si'), 'Goyang');
  assert.equal(canonicalRegion('Washington'), 'Washington DC');
  assert.equal(canonicalRegion('Nonthaburi'), 'Bangkok');
});

test('a canonical or unrelated region is left alone', () => {
  assert.equal(canonicalRegion('Manila'), null);
  assert.equal(canonicalRegion('Washington DC'), null);
  assert.equal(canonicalRegion('Seoul'), null);
  assert.equal(canonicalRegion(undefined), null);
});

test('every alias target has a name a post can carry', () => {
  for (const to of new Set(Object.values(REGION_ALIAS))) assert.ok(REGION_CANONICAL_NAME[to], `no canonical name for ${to}`);
});
