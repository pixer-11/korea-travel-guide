import test from 'node:test';
import assert from 'node:assert/strict';
import { resyncBadge, readBadge, differsOnlyInBadge } from './rating-badge-sync.mjs';

test('rewrites the English badge', () => {
  assert.equal(
    resyncBadge('A shaded reserve above Amalfi. 4.7★ (706 reviews) — what visitors say.', 4.8, 1204),
    'A shaded reserve above Amalfi. 4.8★ (1,204 reviews) — what visitors say.',
  );
});

test('rewrites each localized badge without touching its words', () => {
  const cases = [
    ['4.7★ (리뷰 706개) — 방문객들의 후기', '4.8★ (리뷰 1,204개) — 방문객들의 후기'],
    ['4.7★(706件のレビュー)—訪問者の声', '4.8★(1,204件のレビュー)—訪問者の声'],
    ['4.7★（706条评价）——游客怎么说', '4.8★（1,204条评价）——游客怎么说'],
    ['4.7★ (706 reseñas): lo que dicen', '4.8★ (1,204 reseñas): lo que dicen'],
  ];
  for (const [before, after] of cases) {
    assert.equal(resyncBadge(before, 4.8, 1204), after, before);
  }
});

test('keeps the digit grouping the text already used', () => {
  // A number under 1,000 is no evidence either way — group by default, or every
  // venue that crossed a thousand reviews would lose its comma.
  assert.equal(resyncBadge('4.7★（706条评价）', 4.8, 1204), '4.8★（1,204条评价）');
  assert.equal(resyncBadge('4.7★（1,024条评价）', 4.8, 1204), '4.8★（1,204条评价）');
  // Ungrouped four digits IS evidence: this text does not use separators.
  assert.equal(resyncBadge('4.7★（1024条评价）', 4.8, 1204), '4.8★（1204条评价）');
});

test('returns null when the figures already match', () => {
  assert.equal(resyncBadge('4.8★ (1,204 reviews) — more', 4.8, 1204), null);
});

test('returns null when there is no badge', () => {
  assert.equal(resyncBadge('A quiet reserve above Amalfi.', 4.8, 1204), null);
  assert.equal(resyncBadge('', 4.8, 1204), null);
  assert.equal(resyncBadge(undefined, 4.8, 1204), null);
});

test('refuses to write nonsense figures', () => {
  assert.equal(resyncBadge('4.7★ (706 reviews)', 0, 1204), null);
  assert.equal(resyncBadge('4.7★ (706 reviews)', 4.8, 0), null);
  assert.equal(resyncBadge('4.7★ (706 reviews)', undefined, undefined), null);
});

test('reads the figures a badge claims', () => {
  assert.deepEqual(readBadge('4.7★ (12,733 reviews) — x'), { rating: 4.7, total: 12733 });
  assert.deepEqual(readBadge('4.7★（706条评价）'), { rating: 4.7, total: 706 });
  assert.equal(readBadge('no badge here'), null);
});

test('badge-only difference is recognised, prose changes are not', () => {
  assert.equal(
    differsOnlyInBadge('A reserve. 4.7★ (706 reviews) — x', 'A reserve. 4.8★ (1,204 reviews) — x'),
    true,
  );
  assert.equal(
    differsOnlyInBadge('A reserve. 4.7★ (706 reviews) — x', 'A rewritten reserve. 4.8★ (1,204 reviews) — x'),
    false,
  );
  assert.equal(differsOnlyInBadge('same', 'same'), false);
});
