// The width a Commons pick is judged by is the width actually served.
//   node --test scripts/lib/commons-served-width.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { servedDim } from './commons.mjs';

// 2026-10-05: a 500px original asked for at 2400px comes back as the 500px
// original with thumbwidth=2400 — and passed a 1024px floor ten nights running.
test('a thumbnail is never wider than its original', () => {
  assert.equal(servedDim(2400, 500), 500);
  assert.equal(servedDim(1600, 4000), 1600);
  assert.equal(servedDim(undefined, 900), 900);
  assert.equal(servedDim(1200, undefined), 1200);
  assert.equal(servedDim(undefined, undefined), 0);
});
