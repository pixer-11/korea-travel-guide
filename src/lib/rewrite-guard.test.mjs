import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preservesSubstance, endsMidThought } from './rewrite-guard.mjs';

// The real truncation, from jakarta-the-sounds-project-vol-9 (2026-08-10).
const CUT = 'Tipping isn\'t expected at festival food stalls. The most common mistake visitors make is underestimating Ancol\'s size and distance from the ticket gate to the actual stage area — wearing real shoes, not sandals, was worthwhile given the decent walk from par';
const WHOLE = `${CUT}king or drop-off points. Locals also dressed light and practical: breathable fabrics, a cap, and a small backpack.`;

test('a response cut off mid-word is not a finished rewrite', () => {
  assert.equal(endsMidThought(CUT), true);
  assert.equal(endsMidThought(WHOLE), false);
});

test('structure that legitimately ends without punctuation is fine', () => {
  assert.equal(endsMidThought('Some prose.\n\n## Getting there'), false);
  assert.equal(endsMidThought('| Day | Price |\n| --- | --- |'), false);
});

test('a truncated rewrite is rejected even when it is long enough', () => {
  // 95% of the original by length — the length floor alone would pass it.
  assert.equal(preservesSubstance(WHOLE, CUT, {}), false);
});

test('a rewrite that drops a section is rejected', () => {
  const before = '## A\n\nText one is here.\n\n## B\n\nText two is here.';
  const after = '## A\n\nText one is here, and it is now considerably longer than it was before.';
  assert.equal(preservesSubstance(before, after, { headings: true }), false);
});

test('an honest tense rewrite passes', () => {
  const before = '## A\n\nThe festival will run across three days in August.';
  const after = '## A\n\nThe festival ran across three days in August.';
  assert.equal(preservesSubstance(before, after, { headings: true }), true);
});

test('an empty response is never acceptable', () => {
  assert.equal(preservesSubstance(WHOLE, '', {}), false);
});
