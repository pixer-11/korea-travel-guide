// node --test scripts/lib/country-of-city.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ownCountry } from './country-of-city.mjs';

const { countries } = JSON.parse(readFileSync(new URL('../../data/countries.json', import.meta.url), 'utf8'));

test('a city of another active country moves to it (Canton Library, 2026-10-05)', () => {
  assert.equal(ownCountry('Hong Kong', 'China', countries), 'Hong Kong');
  assert.equal(ownCountry('Taipa', 'China', countries), 'Macau');
  assert.equal(ownCountry('Macau', 'China', countries), 'Macau');
});

test('a city of the searched country, or of no listed country, stays', () => {
  assert.equal(ownCountry('Shanghai', 'China', countries), 'China');
  assert.equal(ownCountry('Somewhere Unlisted', 'China', countries), 'China');
  assert.equal(ownCountry('', 'Japan', countries), 'Japan');
});
