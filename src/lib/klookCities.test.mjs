// klookCityDest: where a "tours in {city}" click lands.
//   node --test src/lib/klookCities.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { klookCityDest, KLOOK_CITY } from './klookCities.ts';

test('a mapped city goes to its destination page', () => {
  const m = KLOOK_CITY.Singapore;
  assert.equal(klookCityDest('Singapore', 'en-US'), `https://www.klook.com/en-US/destination/c${m.id}-${m.slug}/`);
});

// 2026-10-05: Hong Kong's Jordan and Aberdeen searched for the country and the
// Scottish city; Singapore's Katong searched bare.
test('an unmapped district of a city-state goes to the city-state', () => {
  const hk = KLOOK_CITY['Hong Kong'];
  assert.equal(klookCityDest('Nowhere District', 'ko', 'Hong Kong'), `https://www.klook.com/ko/destination/c${hk.id}-${hk.slug}/`);
  const sg = KLOOK_CITY.Singapore;
  assert.equal(klookCityDest('Nowhere Lane', 'ja', 'Singapore'), `https://www.klook.com/ja/destination/c${sg.id}-${sg.slug}/`);
});

test('an unmapped city elsewhere searches with its country, never bare', () => {
  assert.equal(klookCityDest('Nowhereville', 'en-US', 'Germany'), 'https://www.klook.com/en-US/search/?query=Nowhereville%20Germany');
  // no country known: the old bare search, the only thing left to do
  assert.equal(klookCityDest('Nowhereville', 'en-US'), 'https://www.klook.com/en-US/search/?query=Nowhereville');
  // the country itself is not repeated
  assert.equal(klookCityDest('Italy', 'en-US', 'Italy'), 'https://www.klook.com/en-US/search/?query=Italy');
});

test('a same-name row in another country is not used (Codex, 10-05)', () => {
  assert.equal(klookCityDest('Aberdeen', 'en-US', 'United Kingdom'), 'https://www.klook.com/en-US/search/?query=Aberdeen%20United%20Kingdom');
  // Hong Kong district rows still go to Hong Kong
  assert.equal(klookCityDest('Aberdeen', 'en-US', 'Hong Kong'), klookCityDest('Hong Kong', 'en-US', 'Hong Kong'));
  // a city-state filed under another country keeps its own page
  const hk = KLOOK_CITY['Hong Kong'];
  assert.equal(klookCityDest('Hong Kong', 'ko', 'China'), `https://www.klook.com/ko/destination/c${hk.id}-${hk.slug}/`);
});

test('a mapped city keeps its own page even when a country is given', () => {
  const m = KLOOK_CITY.Singapore;
  assert.equal(klookCityDest('Singapore', 'es', 'Singapore'), `https://www.klook.com/es/destination/c${m.id}-${m.slug}/`);
});

// 2026-10-05: Klook does not publish every city in every locale; the localized
// URL of such a city lands on "page not found".
test('a city missing from a Klook locale goes to its English page instead', () => {
  const m = KLOOK_CITY.Izmir;
  assert.equal(klookCityDest('Izmir', 'ko', 'Turkey'), `https://www.klook.com/en-US/destination/c${m.id}-${m.slug}/`);
  assert.equal(klookCityDest('Izmir', 'en-US', 'Turkey'), `https://www.klook.com/en-US/destination/c${m.id}-${m.slug}/`);
  const b = KLOOK_CITY.Bodrum;
  assert.equal(klookCityDest('Bodrum', 'es', 'Turkey'), `https://www.klook.com/en-US/destination/c${b.id}-${b.slug}/`);
  assert.equal(klookCityDest('Bodrum', 'ko', 'Turkey'), `https://www.klook.com/ko/destination/c${b.id}-${b.slug}/`);
});
