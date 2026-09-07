import test from 'node:test';
import assert from 'node:assert/strict';
import { orderPhotoQueue } from './photo-queue-order.mjs';

test('the real priority case: a clicked slug beats a 0-click slug that sorts earlier alphabetically', () => {
  const slugs = ['aaa-no-clicks', 'yeosu-bokchun-restaurant', 'zzz-no-clicks'];
  const perf = {
    'yeosu-bokchun-restaurant': { clicks: 3, impressions: 5, position: 4.3 },
  };
  const out = orderPhotoQueue(slugs, perf);
  assert.equal(out[0], 'yeosu-bokchun-restaurant');
});

test('a clicks tie is broken by impressions', () => {
  const slugs = ['low-impressions', 'high-impressions'];
  const perf = {
    'low-impressions': { clicks: 1, impressions: 5, position: 10 },
    'high-impressions': { clicks: 1, impressions: 50, position: 10 },
  };
  const out = orderPhotoQueue(slugs, perf);
  assert.deepEqual(out, ['high-impressions', 'low-impressions']);
});

test('an impressions tie is broken by position, lower (better) first', () => {
  const slugs = ['worse-position', 'better-position'];
  const perf = {
    'worse-position': { clicks: 2, impressions: 20, position: 40 },
    'better-position': { clicks: 2, impressions: 20, position: 5 },
  };
  const out = orderPhotoQueue(slugs, perf);
  assert.deepEqual(out, ['better-position', 'worse-position']);
});

test('slugs with no entry in perf go last, keeping their original relative order', () => {
  const slugs = ['no-data-b', 'has-data', 'no-data-a'];
  const perf = {
    'has-data': { clicks: 1, impressions: 1, position: 90 },
  };
  const out = orderPhotoQueue(slugs, perf);
  // has-data (real, if weak) row still beats total absence.
  assert.equal(out[0], 'has-data');
  // the two absent slugs keep their INPUT order (b before a) rather than
  // being re-sorted alphabetically or by any other incidental rule.
  assert.deepEqual(out.slice(1), ['no-data-b', 'no-data-a']);
});

test('does not drop or duplicate slugs, including ones absent from perf', () => {
  const slugs = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const perf = { p2: { clicks: 5, impressions: 5, position: 1 } };
  const out = orderPhotoQueue(slugs, perf);
  assert.equal(out.length, slugs.length);
  assert.deepEqual([...out].sort(), [...slugs].sort());
});

test('handles a missing/empty perf object without throwing, preserving order', () => {
  const slugs = ['b', 'a', 'c'];
  assert.deepEqual(orderPhotoQueue(slugs, {}), ['b', 'a', 'c']);
  assert.deepEqual(orderPhotoQueue(slugs, undefined), ['b', 'a', 'c']);
});
