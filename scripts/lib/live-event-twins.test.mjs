import { test } from 'node:test';
import assert from 'node:assert/strict';
import { twinIndex, anchorOf, overlaps, spanOf } from './live-event-twins.mjs';

// The exact pair that shipped on 2026-08-31: the alt-photo patrol gave
// jakarta-the-sounds-project-2026 a verified hero, lifted its draft flag, and
// put it up beside the Vol. 9 guide that had been live since 07-24.
const VOL9 = { title: 'The Sounds Project Vol. 9: What to Know (Jakarta)', country: 'Indonesia', eventStartDate: '2026-08-07', eventEndDate: '2026-08-09' };
const TSP26 = { title: 'The Sounds Project 2026: What to Know (Jakarta)', country: 'Indonesia', eventStartDate: '2026-08-07', eventEndDate: '2026-08-09' };
const LALALA_LIVE = { title: 'LaLaLa Festival 2026: What to Know (Jakarta)', country: 'Indonesia', eventStartDate: '2026-08-22', eventEndDate: '2026-08-23' };
const LALALA_TWIN = { title: 'LALALA Fest 2026: What to Know (Jakarta)', country: 'Indonesia', eventStartDate: '2026-08-22', eventEndDate: '2026-08-23' };

test('the twin the phrasing hid is caught', () => {
  const live = twinIndex();
  live.note(VOL9);
  live.note(LALALA_LIVE);
  assert.equal(live.alreadyLive(TSP26), true);
  assert.equal(live.alreadyLive(LALALA_TWIN), true);
});

test('dates that only touch still count as one event', () => {
  const live = twinIndex();
  live.note({ ...VOL9, eventStartDate: '2026-08-07', eventEndDate: '2026-08-08' });
  assert.equal(live.alreadyLive({ ...TSP26, eventStartDate: '2026-08-08', eventEndDate: '2026-08-09' }), true);
});

// The other half of the guard: it must not hold back events that are NOT twins,
// or the photo patrol quietly stops publishing anything it re-photographs.
test('a different act in the same city on the same night is not a twin', () => {
  const live = twinIndex();
  live.note(VOL9);
  assert.equal(live.alreadyLive({ title: 'Java Jazz Festival 2026 (Jakarta)', country: 'Indonesia', eventStartDate: '2026-08-07', eventEndDate: '2026-08-09' }), false);
});

test('the same act in another country, or a year apart, is not a twin', () => {
  const live = twinIndex();
  live.note(VOL9);
  assert.equal(live.alreadyLive({ ...TSP26, country: 'Malaysia' }), false);
  assert.equal(live.alreadyLive({ ...TSP26, eventStartDate: '2027-08-07', eventEndDate: '2027-08-09' }), false);
});

test('an empty index holds nothing back', () => {
  assert.equal(twinIndex().alreadyLive(TSP26), false);
});

// keyToken finds no anchor in an all-stop-word name ('Italian Grand Prix', the
// 2026-08-16 lesson). Anchorless titles must not all collide into one bucket.
test('titles with no anchor word never match each other', () => {
  const live = twinIndex();
  const a = { title: 'The Grand Prix', country: 'Italy', eventStartDate: '2026-09-06', eventEndDate: '2026-09-06' };
  const b = { title: 'A Grand Prix', country: 'Italy', eventStartDate: '2026-09-06', eventEndDate: '2026-09-06' };
  if (anchorOf(a).startsWith('|')) {
    live.note(a);
    assert.equal(live.alreadyLive(b), false);
  }
});

test('spans and overlap read the frontmatter the posts actually carry', () => {
  assert.deepEqual(spanOf({ eventStartDate: '2026-08-07' }), ['2026-08-07', '2026-08-07']);
  assert.equal(overlaps(['2026-08-07', '2026-08-09'], ['2026-08-09', '2026-08-10']), true);
  assert.equal(overlaps(['2026-08-07', '2026-08-09'], ['2026-08-10', '2026-08-11']), false);
  assert.equal(overlaps(['', ''], ['2026-08-07', '2026-08-07']), false);
});
