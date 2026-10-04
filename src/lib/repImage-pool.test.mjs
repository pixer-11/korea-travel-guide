// repHeroPool (lib/repImage.ts, 2026-10-04): the rotating country photo on the
// when-to-go index.  node --test src/lib/repImage-pool.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { repHeroPool } from './repImage.ts';

const post = (category, url, name = 'Somewhere') => ({ data: { category, heroImage: { url }, place: { name } } });

test('sights only, no events or placeholders, in the caller order', () => {
  const pool = repHeroPool([
    post('restaurant', 'https://x/food.jpg'),
    post('attraction', 'https://x/palace.jpg'),
    post('event', 'https://x/concert.jpg'),
    post('hidden-gem', 'https://x/alley.jpg'),
    post('attraction', 'https://x/placeholder-1.jpg'),
  ]);
  assert.deepEqual(pool, ['https://x/palace.jpg', 'https://x/alley.jpg']);
});

test('with fewer than two sights, cafés and food may fill the rotation', () => {
  assert.deepEqual(repHeroPool([post('trendy', 'https://x/cafe.jpg'), post('attraction', 'https://x/one.jpg')]), ['https://x/cafe.jpg', 'https://x/one.jpg']);
});

test('places of atrocity and remembrance stay out of a decorative rotation', () => {
  const pool = repHeroPool([
    post('attraction', 'https://x/angkor.jpg', 'Angkor Wat'),
    post('attraction', 'https://x/s21.jpg', 'Tuol Sleng Genocide Museum'),
    post('attraction', 'https://x/war.jpg', 'War Remnants Museum'),
    post('attraction', 'https://x/bayon.jpg', 'Bayon Temple'),
  ]);
  assert.deepEqual(pool, ['https://x/angkor.jpg', 'https://x/bayon.jpg']);
  // Every such sight in the guides on 10-04, by name (Codex found the gaps).
  for (const name of ['Atomic Bomb Dome', 'Hiroshima Peace Memorial Museum', 'Peace Memorial Park - Hiroshima', 'Australian War Memorial',
    'Hellfire Pass Interpretive Centre', 'Jallianwala Bagh', 'Phu Quoc Prison History Museum']) {
    assert.deepEqual(repHeroPool([post('attraction', 'https://x/a.jpg', name), post('attraction', 'https://x/b.jpg', 'Old Town')]), ['https://x/b.jpg'], name);
  }
});

test('a landmark called a memorial is still a landmark (Codex, 10-04)', () => {
  for (const name of ['Lincoln Memorial', 'Victoria Memorial', 'India Gate', 'Fremantle Prison']) {
    assert.deepEqual(repHeroPool([post('attraction', 'https://x/a.jpg', name), post('attraction', 'https://x/b.jpg', 'Old Town')]), ['https://x/a.jpg', 'https://x/b.jpg'], name);
  }
});

test('at most n, no duplicates', () => {
  const many = Array.from({ length: 12 }, (_, i) => post('attraction', `https://x/${i % 10}.jpg`));
  const pool = repHeroPool(many, 8);
  assert.equal(pool.length, 8);
  assert.equal(new Set(pool).size, 8);
});
