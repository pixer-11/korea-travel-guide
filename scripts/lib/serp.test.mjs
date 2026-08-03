import test from 'node:test';
import assert from 'node:assert/strict';
import { clip, strongRating, ratingBadge, withRatingSignal } from './serp.mjs';
import { makeTitle } from './titles.mjs';

test('strongRating: only real, strong ratings qualify — never invented', () => {
  assert.equal(strongRating(null), null); // placeless post
  assert.equal(strongRating({}), null); // venue with no rating stored
  assert.equal(strongRating({ rating: 3.9, userRatingsTotal: 5000 }), null); // below 4.0
  assert.equal(strongRating({ rating: 4.8, userRatingsTotal: 99 }), null); // thin sample
  assert.deepEqual(strongRating({ rating: 4.2, userRatingsTotal: 335 }), { rating: 4.2, total: 335 });
});

test('ratingBadge formats the stored numbers exactly', () => {
  assert.equal(ratingBadge({ rating: 4.9, userRatingsTotal: 39410 }), '4.9★ (39,410 reviews)');
  assert.equal(ratingBadge({ rating: 5, userRatingsTotal: 120 }), '5.0★ (120 reviews)');
  assert.equal(ratingBadge({ rating: 3.2, userRatingsTotal: 9000 }), '');
});

test('withRatingSignal appends a terminal-punctuated sentence once', () => {
  const desc = 'A quiet grill house on Mina Street.';
  const place = { rating: 4.9, userRatingsTotal: 1961 };
  const out = withRatingSignal(desc, place);
  assert.equal(out, 'A quiet grill house on Mina Street. 4.9★ (1,961 reviews) — what visitors say, hours, and tips.');
  assert.match(out, /[.!?]$/); // TRUNCATED-DESCRIPTION gate: terminal punctuation
  assert.equal(withRatingSignal(out, place), out); // idempotent — never double-appends
});

test('withRatingSignal leaves writer-woven review copy untouched', () => {
  const woven = 'A busy, well-rated (4.9-star, 39,000+ reviews) grill house.';
  assert.equal(withRatingSignal(woven, { rating: 4.9, userRatingsTotal: 39410 }), woven);
  assert.equal(withRatingSignal('No data here.', null), 'No data here.');
});

test('clip ends on a sentence or closes the fragment as one', () => {
  const twoSentences = 'S'.repeat(80) + '. ' + 'T'.repeat(200) + '.';
  assert.match(clip(twoSentences), /\.$/);
  assert.equal(clip('short.'), 'short.');
});

test('makeTitle appends the star badge only within the 60-char budget', () => {
  const strong = { rating: 4.9, userRatingsTotal: 1961 };
  assert.equal(
    makeTitle('Garden to Table Chiangmai', { category: 'restaurant', region: 'Chiang Mai' }, strong),
    'Garden to Table Chiangmai: Where to Eat in Chiang Mai (4.9★)'
  );
  // 77-char title → badge skipped, name never truncated to make room.
  assert.equal(
    makeTitle('Wheels Coffee Roasters - Heritage Lifestyle Hub (Riau)', { category: 'trendy', region: 'Bandung' }, strong),
    'Wheels Coffee Roasters - Heritage Lifestyle Hub (Riau): Bandung Travel Guide'
  );
  // No place / weak rating → exact pre-badge behavior (no title churn).
  assert.equal(
    makeTitle('Shwi', { category: 'restaurant', region: 'Paris' }),
    'Shwi: Where to Eat in Paris'
  );
  assert.equal(
    makeTitle('Shwi', { category: 'restaurant', region: 'Paris' }, { rating: 3.8, userRatingsTotal: 500 }),
    'Shwi: Where to Eat in Paris'
  );
});
