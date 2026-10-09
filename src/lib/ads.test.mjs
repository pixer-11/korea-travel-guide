import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adsenseClient, adsEnabled, adsTxtLines, adsenseLoaderSrc } from './ads.mjs';

test('an empty data file keeps the site ad-free: no loader, no ads.txt', () => {
  const ads = JSON.parse(readFileSync(new URL('../../data/ads.json', import.meta.url), 'utf8'));
  // The committed file may be switched on later; what must hold is that an
  // empty client means nothing renders.
  const off = { ...ads, adsense: { client: '' } };
  assert.equal(adsenseClient(off), '');
  assert.equal(adsEnabled(off), false);
  assert.deepEqual(adsTxtLines(off), []);
  assert.equal(adsenseLoaderSrc(off), '');
});

test('a valid AdSense id yields the loader and the ads.txt line without the ca- prefix', () => {
  const ads = { adsense: { client: 'ca-pub-1234567890123456' } };
  assert.equal(adsEnabled(ads), true);
  assert.equal(adsenseLoaderSrc(ads), 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456');
  assert.deepEqual(adsTxtLines(ads), ['google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0']);
});

test('a malformed id is treated as off, never injected into the page', () => {
  for (const bad of ['pub-123', 'ca-pub-abc', '<script>', 'ca-pub-123']) {
    assert.equal(adsenseClient({ adsense: { client: bad } }), '', bad);
    assert.equal(adsenseLoaderSrc({ adsense: { client: bad } }), '', bad);
  }
});

test('extra ads.txt lines pass through trimmed, blanks dropped', () => {
  const ads = { adsense: { client: '' }, extraAdsTxt: ['  example.com, 42, RESELLER  ', '', '   '] };
  assert.deepEqual(adsTxtLines(ads), ['example.com, 42, RESELLER']);
});
