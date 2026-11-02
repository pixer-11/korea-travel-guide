import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { guideProductFor } from './guide-product.mjs';

const P = { 'tokyo-3-days': { url: 'https://example.gumroad.com/l/x', price: '$12', stopsHash: '752277df' } };

test('the card shows only while the page is the itinerary the PDF was built from', () => {
  assert.deepEqual(guideProductFor(P, 'tokyo-3-days', '752277df'), { url: 'https://example.gumroad.com/l/x', price: '$12' });
  // 11-02: the page had been regenerated (fdf4a6da…) and the card still sold the old stops.
  assert.equal(guideProductFor(P, 'tokyo-3-days', 'fdf4a6da'), null);
});

test('an unrecorded build is not offered — fail closed', () => {
  const noHash = { 'tokyo-3-days': { url: 'https://example.gumroad.com/l/x', price: '$12' } };
  assert.equal(guideProductFor(noHash, 'tokyo-3-days', '752277df'), null);
  assert.equal(guideProductFor(P, 'tokyo-3-days', undefined), null);
  assert.equal(guideProductFor(P, 'osaka-3-days', '752277df'), null);
  assert.equal(guideProductFor(null, 'tokyo-3-days', '752277df'), null);
});

test('the real product file names a build for every product', () => {
  const real = JSON.parse(readFileSync(new URL('../../data/gumroad-products.json', import.meta.url), 'utf8'));
  for (const [slug, p] of Object.entries(real)) {
    if (slug.startsWith('_')) continue;
    assert.match(String(p.stopsHash || ''), /^[0-9a-f]{40}$/, `${slug}: stopsHash of the itinerary the PDF was built from`);
  }
});
