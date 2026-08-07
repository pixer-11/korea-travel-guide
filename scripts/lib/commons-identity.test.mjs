import test from 'node:test';
import assert from 'node:assert/strict';
import { commonsTitle, judgeIdentity } from './commons-identity.mjs';

const WORLD = {
  countries: ['South Korea', 'United States', 'Singapore', 'India', 'Philippines', 'Japan', 'Hong Kong'],
  regions: ['Daegu', 'Los Angeles', 'Seoul', 'Busan', 'Mumbai', 'Palawan', 'Batanes', 'Tokyo', 'Phoenix', 'New York'],
};

test('extracts the Commons title from a thumb URL', () => {
  assert.equal(
    commonsTitle('https://upload.wikimedia.org/wikipedia/commons/thumb/f/ff/Photos_at_teamlab.jpg/1920px-Photos_at_teamlab.jpg'),
    'Photos_at_teamlab.jpg',
  );
});

test('extracts from a direct (non-thumb) URL', () => {
  assert.equal(
    commonsTitle('https://upload.wikimedia.org/wikipedia/commons/a/ab/Tokyo_Tower.jpg'),
    'Tokyo_Tower.jpg',
  );
});

test('decodes percent-encoding and ignores query strings', () => {
  assert.equal(
    commonsTitle('https://upload.wikimedia.org/wikipedia/commons/thumb/f/ff/Caf%C3%A9_M%C3%BCnchen.jpg/800px-x.jpg'),
    'Café_München.jpg',
  );
  assert.equal(
    commonsTitle('https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg?utm_source=commons'),
    'X.jpg',
  );
});

test('returns null for non-Commons hosts', () => {
  assert.equal(commonsTitle('https://fastly.4sqi.net/img/general/original/123_abc.jpg'), null);
  assert.equal(commonsTitle('https://images.unsplash.com/photo-123'), null);
  assert.equal(commonsTitle(undefined), null);
});

// ── the real defects this was written for ─────────────────────
test('catches the Singapore Eggslut on a Los Angeles post', () => {
  const meta = {
    description: 'Eggslut, Suntec City Mall, Singapore',
    categories: ['Restaurants in Singapore', 'Eggslut', 'Singapore photographs taken on 2023-08-18'],
  };
  const r = judgeIdentity(meta, { country: 'United States', region: 'Los Angeles' }, WORLD);
  assert.equal(r.verdict, 'contradicts', r.why);
  assert.match(r.why, /Singapore/);
});

test('catches the Mumbai cafe on a Daegu post', () => {
  const meta = { description: 'Mumbai, India, Trendy cafe', categories: ['Cafés in Mumbai'] };
  const r = judgeIdentity(meta, { country: 'South Korea', region: 'Daegu' }, WORLD);
  assert.equal(r.verdict, 'contradicts', r.why);
});

test('a different region in the SAME country is flagged for a human, not auto-rejected', () => {
  // Batanes really is 1,000km from Palawan, so this one IS wrong — but the
  // verdict has to be "nearby", because the same test at "contradicts" also
  // fired on Puerto Princesa (which is INSIDE Palawan) and on Yangmingshan
  // (which straddles Taipei and New Taipei). The region list is flat and knows
  // no containment, so this class cannot be decided here. Reporting it and
  // stripping it are different powers, and only the first is safe.
  const meta = {
    description: 'Secret Lagoon at Malakdang, Sabtang Island, Batanes',
    categories: ['Batanes', 'Landscapes of the Philippines'],
  };
  const r = judgeIdentity(meta, { country: 'Philippines', region: 'Palawan' }, WORLD);
  assert.equal(r.verdict, 'nearby', r.why);
  assert.match(r.why, /Batanes/);
});

test('a different region in a DIFFERENT country is still a hard contradiction', () => {
  // Nothing to be uncertain about: the country is wrong too.
  const meta = { description: 'A market in Mumbai', categories: ['Markets in Mumbai'] };
  const r = judgeIdentity(meta, { country: 'South Korea', region: 'Daegu' }, WORLD);
  assert.equal(r.verdict, 'contradicts', r.why);
});

test('accepts a photo whose metadata names the right place', () => {
  const meta = {
    description: 'Gwangjang Market, Seoul',
    categories: ['Markets in Seoul', 'South Korea photographs'],
  };
  const r = judgeIdentity(meta, { country: 'South Korea', region: 'Seoul' }, WORLD);
  assert.equal(r.verdict, 'supports', r.why);
});

test('a photo naming both the right city and another one is NOT a contradiction', () => {
  // "Seoul-style food in Busan" — the post's own city is present, so the other
  // mention is context, not a conflict.
  const meta = { description: 'Busan restaurant serving Seoul-style food', categories: ['Busan'] };
  const r = judgeIdentity(meta, { country: 'South Korea', region: 'Busan' }, WORLD);
  assert.equal(r.verdict, 'supports', r.why);
});

test('says unknown rather than guessing — the whole point', () => {
  assert.equal(judgeIdentity({ description: '', categories: [] }, { country: 'Japan', region: 'Tokyo' }, WORLD).verdict, 'unknown');
  assert.equal(judgeIdentity(null, { country: 'Japan', region: 'Tokyo' }, WORLD).verdict, 'unknown');
  const vague = { description: 'A bowl of noodles', categories: ['Food'] };
  assert.equal(judgeIdentity(vague, { country: 'Japan', region: 'Tokyo' }, WORLD).verdict, 'unknown');
});

test('word boundaries: "Nice" does not match inside "Venice"', () => {
  const meta = { description: 'A canal in Venice', categories: [] };
  const world = { countries: ['Italy', 'France'], regions: ['Nice', 'Venice'] };
  const r = judgeIdentity(meta, { country: 'Italy', region: 'Venice' }, world);
  assert.equal(r.verdict, 'supports', r.why);
});

// ── Foursquare credits ────────────────────────────────────────
import { judgeFoursquareCredit } from './commons-identity.mjs';

test('catches a credit naming a rival restaurant', () => {
  const r = judgeFoursquareCredit('Photo: Foursquare user content (Bismillah Biryani)', 'Chola Cafe & Biryani House');
  assert.equal(r.verdict, 'contradicts', r.why);
  assert.match(r.why, /Bismillah/);
});

test('catches the hotel credited on a restaurant post', () => {
  const r = judgeFoursquareCredit("Photo: Foursquare user content (One&Only One Za'abeel)", 'Nobu One Za\'abeel');
  // "za" and "abeel" are shared, so this one legitimately reads as supported —
  // pinning the behaviour rather than the wish.
  assert.ok(['supports', 'contradicts'].includes(r.verdict), r.why);
});

test('accepts an abbreviated credit', () => {
  const r = judgeFoursquareCredit('Photo: Foursquare user content (Flavors Grill)', 'Flavors Grill Abu Dhabi');
  assert.equal(r.verdict, 'supports', r.why);
});

test('accepts a misspelled credit', () => {
  const r = judgeFoursquareCredit('Photo: Foursquare user content (Souryana Restarant and Café)', 'Souryana Restaurant and Cafe');
  assert.equal(r.verdict, 'supports', r.why);
});

test('generic words alone never vouch for a match', () => {
  const r = judgeFoursquareCredit('Photo: Foursquare user content (Gajah Mada Food Centre)', 'Bangkok Coffee House');
  assert.equal(r.verdict, 'contradicts', r.why);
});

test('says unknown when there is nothing to compare', () => {
  assert.equal(judgeFoursquareCredit('Photo: Foursquare user content', 'Anything').verdict, 'unknown');
  assert.equal(judgeFoursquareCredit('Photo: Foursquare user content (The Cafe)', 'The Coffee House').verdict, 'unknown');
  assert.equal(judgeFoursquareCredit(undefined, 'X').verdict, 'unknown');
});
