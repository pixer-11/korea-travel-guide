import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderCandidates } from './backfill-place-details.mjs';

// orderCandidates powers the default (no --slugs) run: itinerary stops/rain-
// swaps should be processed before the daily --limit cap reaches them, since
// they're what the closed-day warning chips depend on. Only order changes —
// these tests assert the reordering itself, not any of the fetch/skip logic.

test('orderCandidates: a priority slug sorts ahead of an alphabetically-earlier non-priority slug', () => {
  const files = ['aaa-alpha.md', 'zzz-priority.md'];
  const priority = new Set(['zzz-priority']);
  const out = orderCandidates(files, priority);
  assert.deepEqual(out, ['zzz-priority.md', 'aaa-alpha.md']);
});

test('orderCandidates: an empty priority set leaves the order untouched', () => {
  const files = ['b-post.md', 'a-post.md', 'c-post.md'];
  const out = orderCandidates(files, new Set());
  assert.deepEqual(out, files);
});

test('orderCandidates: a missing/undefined priority set leaves the order untouched', () => {
  const files = ['b-post.md', 'a-post.md'];
  const out = orderCandidates(files, undefined);
  assert.deepEqual(out, files);
});

test('orderCandidates: the priority group itself is sorted alphabetically, not input order', () => {
  const files = ['m-post.md', 'z-priority.md', 'a-priority.md'];
  const priority = new Set(['z-priority', 'a-priority']);
  const out = orderCandidates(files, priority);
  assert.deepEqual(out, ['a-priority.md', 'z-priority.md', 'm-post.md']);
});

test('orderCandidates: non-priority files keep their existing relative order', () => {
  const files = ['c-post.md', 'a-priority.md', 'b-post.md', 'd-post.md'];
  const priority = new Set(['a-priority']);
  const out = orderCandidates(files, priority);
  assert.deepEqual(out, ['a-priority.md', 'c-post.md', 'b-post.md', 'd-post.md']);
});
