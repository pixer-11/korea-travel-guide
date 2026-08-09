import test from 'node:test';
import assert from 'node:assert/strict';
import { isOffTopicHero, offTopicToken, OFFTOPIC } from './offtopic.mjs';

const COSPLAY = {
  url: 'https://upload.wikimedia.org/x/Comic_Market_92_Day_3-_Cosplayers_%2838738505232%29.jpg',
  credit: 'Photo: Dick Thomas Johnson / Wikimedia Commons',
  license: 'wikimedia',
};

// 2026-08-09: the Comiket hero was vision-verified MATCH ("cosplay IS Comiket
// culture") yet the keyword guard reported it as a mismatch every night, and
// backfill-venue-photos sorts flagged heroes first — i.e. it was queued to have
// a correct photo replaced. Both directions are asserted: excused only for the
// article that is actually about it.
test('a cosplay hero is on-topic for a Comiket page', () => {
  assert.equal(isOffTopicHero(COSPLAY, 'Comic Market 108 (Summer Comiket): What to Know in Tokyo'), false);
});
test('the same cosplay hero is still off-topic for a ramen shop', () => {
  assert.equal(isOffTopicHero(COSPLAY, 'Ichiran Ramen Shibuya: What to Know in Tokyo'), true);
});
test('context never excuses an unrelated token', () => {
  assert.equal(isOffTopicHero({ url: 'https://upload.wikimedia.org/x/Ambulyx_MHNT.ZOO.jpg', credit: '', license: 'wikimedia' }, 'Comic Market 108 Comiket'), true);
});
test('offTopicToken names the token it blocked, null when clean', () => {
  assert.match(offTopicToken('Dune_bashing_Dubai.jpg', 'Burj Khalifa Dubai'), /Dune_bashing/);
  assert.equal(offTopicToken('Burj_Khalifa_2023.jpg', 'Burj Khalifa Dubai'), null);
});
test('the legacy OFFTOPIC blocklist still matches every token', () => {
  for (const hay of ['x_MHNT.jpg', 'Dune_bashing.jpg', 'ambulance.jpg', 'US_Navy_x.jpg', 'Orphanage.jpg', 'cosplay.jpg', 'British_Museum.jpg', '_inscription.jpg', 'Google_Art_Project.jpg', 'geograph.org.uk/x', 'Oxomoco.jpg', 'Ketchikan.jpg', 'x_Glencoe.jpg']) {
    assert.equal(OFFTOPIC.test(hay), true, hay);
  }
  assert.equal(OFFTOPIC.test('Burj_Khalifa_2023.jpg'), false);
});

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
