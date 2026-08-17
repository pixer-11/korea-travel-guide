import test from 'node:test';
import assert from 'node:assert/strict';
import { findRatings, syncProseRating, ratingClaimProblems, differsOnlyInRating } from './prose-rating-sync.mjs';

const sync = (s, stale, live) => syncProseRating(s, stale, live).text;

// ── what must be resynced ──────────────────────────────────────────────────
// Every string here is verbatim from a live page on 2026-08-17.

test('the English sentence that started this — 4.8 above a 4.7 fact box', () => {
  const s = 'archaeological zones in Southeast Asia — verified visitor ratings put it at 4.8 stars, reflecting how';
  assert.equal(sync(s, 4.8, 4.7), 'archaeological zones in Southeast Asia — verified visitor ratings put it at 4.7 stars, reflecting how');
});

test('each language keeps its own words and gives up only its digits', () => {
  assert.equal(sync('실제 방문객 평점은 4.8점으로, 앙코르나', 4.8, 4.7), '실제 방문객 평점은 4.7점으로, 앙코르나');
  assert.equal(sync('レビューで評価4.8を獲得しており、', 4.8, 4.7), 'レビューで評価4.7を獲得しており、');
  assert.equal(sync('经核实的游客评分高达4.8星，可见', 4.8, 4.7), '经核实的游客评分高达4.7星，可见');
  assert.equal(sync('las calificaciones de los visitantes le otorgan 4.8 estrellas', 4.8, 4.7), 'las calificaciones de los visitantes le otorgan 4.7 estrellas');
});

test("Spanish's comma decimal survives the swap", () => {
  // es writes 4,5 as often as 4.5; rewriting it as "4.6" would be a typo in
  // that language, so each occurrence keeps the separator it was written with.
  assert.equal(sync('una calificación de 4,5 estrellas', 4.5, 4.6), 'una calificación de 4,6 estrellas');
});

test('a rating written far from its cue is still found (Spanish is verbose)', () => {
  // 22 characters between "calificación" and the number — the window is sized
  // to the longest real example in the corpus, and this was a miss before.
  const s = 'ha logrado una calificación inusualmente alta de 4.8 en más de 400 reseñas';
  assert.equal(sync(s, 4.8, 4.6), 'ha logrado una calificación inusualmente alta de 4.6 en más de 400 reseñas');
});

test('a Chinese comma before the number does not hide it', () => {
  // The digit-grouping lookbehind used to veto on any comma, which silently
  // skipped every rating Chinese writes as "(538条评论,4.4星)".
  assert.equal(sync('评分很高(538条评论,4.4星)', 4.4, 4.3), '评分很高(538条评论,4.3星)');
});

test('"4.7分" is points, not minutes', () => {
  assert.equal(sync('在当地积累了很高的口碑(81条评价,4.7分)', 4.7, 4.5), '在当地积累了很高的口碑(81条评价,4.5分)');
});

test('every occurrence in a body is resynced, not just the first', () => {
  const s = 'A 4.8 rating draws the queue. Even so, that 4.8 average hides a slow kitchen.';
  assert.equal(sync(s, 4.8, 4.6), 'A 4.6 rating draws the queue. Even so, that 4.6 average hides a slow kitchen.');
});

// ── what must NOT be touched (the boundaries that keep this safe) ──────────

test('a hedge is never rewritten — it is true across a range', () => {
  // Málaga, 2026-08-17: prose "above 4.5", live 4.6. The sentence is TRUE, and
  // resyncing it to "above 4.6" would have made it false. This is the single
  // most important assertion in the file.
  const s = 'with well over 14,000 reviews and a rating that consistently sits above 4.5, it is firmly';
  assert.equal(sync(s, 4.5, 4.6), s);
  assert.equal(syncProseRating(s, 4.5, 4.6).count, 0);
});

test('hedges in every flavour survive', () => {
  for (const s of [
    'With a rating around 4.3 from well over a thousand',
    'a rating holding steady above 4.4 across thousands',
    'has built a loyal following (rated around 4.0 from well over 2,000',
    'With a rating hovering around 4.8 from a tight base',
    'una calificación de alrededor de 4.6 sobre',
    '평점 약 4.6점을 기록하며',
    'レビューで評価はおよそ4.6を獲得しており',
  ]) assert.equal(sync(s, parseFloat(s.match(/[1-5][.,]\d/)[0]), 4.9), s, s);
});

test('a bare decimal with no rating cue is left alone', () => {
  assert.equal(sync('The trailhead is 4.8 km from the station.', 4.8, 4.7), 'The trailhead is 4.8 km from the station.');
  assert.equal(sync('Allow 4.8 hours for the full loop.', 4.8, 4.7), 'Allow 4.8 hours for the full loop.');
});

test('a unit vetoes even when a rating cue is in the same sentence', () => {
  // The sentence this guard exists for: two numbers, one a distance.
  const s = 'a 4.8 km walk from the highly rated market';
  assert.equal(sync(s, 4.8, 4.5), s);
});

test('a longer number is never clipped', () => {
  assert.equal(sync('drawing 14.8 million visitors a year, reviews say', 4.8, 4.7), 'drawing 14.8 million visitors a year, reviews say');
  assert.equal(sync('a rating of 4.85 in the old survey', 4.8, 4.7), 'a rating of 4.85 in the old survey');
  assert.equal(sync('across 2,109.8 reviews', 4.8, 4.7), 'across 2,109.8 reviews');
});

test('a review COUNT that happens to read like a rating is not a rating', () => {
  assert.equal(sync('with more than 4.8 million reviews logged', 4.8, 4.7), 'with more than 4.8 million reviews logged');
});

// ── the claim checker ──────────────────────────────────────────────────────

test('an exact claim is wrong the moment it differs', () => {
  const p = ratingClaimProblems('verified visitor ratings put it at 4.8 stars', 4.7);
  assert.equal(p.length, 1);
  assert.match(p[0].reason, /prose states 4\.8, live data says 4\.7/);
});

test('an exact claim that still matches is silent', () => {
  assert.deepEqual(ratingClaimProblems('verified visitor ratings put it at 4.7 stars', 4.7), []);
});

test('a hedge is judged by its own direction, not by equality', () => {
  const s = 'a rating that consistently sits above 4.5';
  assert.deepEqual(ratingClaimProblems(s, 4.6), []);          // true: 4.6 is above 4.5
  assert.deepEqual(ratingClaimProblems(s, 4.5), []);          // still not contradicted
  assert.equal(ratingClaimProblems(s, 4.3).length, 1);        // now plainly false
  assert.equal(ratingClaimProblems(s, 4.3)[0].hedge, 'above');
});

test('an "around" hedge tolerates a wobble but not a wander', () => {
  const s = 'With a rating around 4.3 from well over a thousand reviews';
  assert.deepEqual(ratingClaimProblems(s, 4.5), []);
  assert.equal(ratingClaimProblems(s, 4.8).length, 1);
});

// ── the srcHash safety catch ───────────────────────────────────────────────

test('a number-only edit is recognised so translations are not re-queued', () => {
  const before = 'verified visitor ratings put it at 4.8 stars, reflecting how it impresses';
  const after = 'verified visitor ratings put it at 4.7 stars, reflecting how it impresses';
  assert.equal(differsOnlyInRating(before, after, 4.8, 4.7), true);
});

test('a prose edit riding along with the number refuses the re-stamp', () => {
  const before = 'verified visitor ratings put it at 4.8 stars, reflecting how it impresses';
  const after = 'verified visitor ratings put it at 4.7 stars, though the queues have grown';
  assert.equal(differsOnlyInRating(before, after, 4.8, 4.7), false);
});
