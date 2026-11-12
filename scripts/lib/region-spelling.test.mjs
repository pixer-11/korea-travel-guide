import test from 'node:test';
import assert from 'node:assert/strict';
import { regionSpellings, adoptRegionSpelling, spellingTwins } from './region-spelling.mjs';

const ph = (region, f) => ({ country: 'Philippines', region, f });
const iloilo = [...Array.from({ length: 7 }, (_, i) => ph('Iloilo', `iloilo-${i}.md`)), ph('Iloilo City', 'iloilo-city-dinagyang-festival.md')];

test('a newcomer adopts the spelling the live guides use (11-12, Iloilo)', () => {
  const s = regionSpellings(iloilo.slice(0, 7));
  assert.equal(adoptRegionSpelling('Iloilo City', 'Philippines', s), 'Iloilo');
  assert.equal(adoptRegionSpelling('iloilo  city', 'Philippines', s), 'Iloilo');
});

test('an unknown city, or the same name in another country, is left as given', () => {
  const s = regionSpellings(iloilo.slice(0, 7));
  assert.equal(adoptRegionSpelling('Bacolod', 'Philippines', s), 'Bacolod');
  assert.equal(adoptRegionSpelling('Iloilo City', 'Spain', s), 'Iloilo City');
});

test('the validator names the one odd post, not the seven established ones', () => {
  const twins = spellingTwins(iloilo);
  assert.deepEqual(twins.map((t) => [t.post.f, t.canonical]), [['iloilo-city-dinagyang-festival.md', 'Iloilo']]);
});

test('a city with one spelling, or two cities, is no twin', () => {
  assert.deepEqual(spellingTwins([ph('Cebu', 'a'), ph('Cebu', 'b'), ph('Manila', 'c')]), []);
  assert.deepEqual(spellingTwins([ph('Cebu', 'a'), { country: 'Spain', region: 'Cebu City', f: 'b' }]), []);
});

test('a city that shares its name with a province or country stays its own place', () => {
  const s = regionSpellings([ph('Quezon', 'a'), { country: 'Mexico', region: 'Mexico', f: 'b' }]);
  assert.equal(adoptRegionSpelling('Quezon City', 'Philippines', s), 'Quezon City');
  assert.equal(adoptRegionSpelling('Mexico City', 'Mexico', s), 'Mexico City');
  assert.deepEqual(spellingTwins([ph('Quezon', 'a'), ph('Quezon City', 'b')]), []);
});

test('on a tie the spelling met first wins, so the verdict is stable', () => {
  assert.deepEqual(spellingTwins([ph('Cebu', 'a'), ph('Cebu City', 'b')]).map((t) => t.post.f), ['b']);
});
