import test from 'node:test';
import assert from 'node:assert/strict';
import { isOffTopicHero } from './offtopic.mjs';

test('rejects a moth-specimen wikimedia hero', () => {
  assert.equal(isOffTopicHero({ url: 'https://upload.wikimedia.org/x/Ambulyx_MHNT.ZOO.jpg', credit: 'MHNT', license: 'wikimedia' }), true);
});
test('rejects a dune-bashing wikimedia hero', () => {
  assert.equal(isOffTopicHero({ url: 'https://upload.wikimedia.org/x/Dune_bashing_Dubai.jpg', credit: '', license: 'wikimedia' }), true);
});
test('accepts a clean wikimedia hero', () => {
  assert.equal(isOffTopicHero({ url: 'https://upload.wikimedia.org/x/Burj_Khalifa_2023.jpg', credit: 'x', license: 'wikimedia' }), false);
});
test('accepts a curated unsplash hero', () => {
  assert.equal(isOffTopicHero({ url: 'https://images.unsplash.com/photo-1512453979798', credit: 'x', license: 'unsplash' }), false);
});
test('rejects a placeholder', () => {
  assert.equal(isOffTopicHero({ url: '/img/placeholder.jpg', license: 'placeholder' }), true);
});
test('rejects when there is no image', () => {
  assert.equal(isOffTopicHero(null), true);
});
