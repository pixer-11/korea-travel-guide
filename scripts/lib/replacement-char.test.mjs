// isFaithfulRestore decides whether a repaired line may replace a broken one.
//   node --test scripts/lib/replacement-char.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { REPLACEMENT_CHAR as R, isFaithfulRestore, hasReplacementChar } from './replacement-char.mjs';

// Real broken lines from 2026-10-05, and what they should have said.
test('accepts the lost letter put back and nothing else', () => {
  assert.equal(isFaithfulRestore(`돌${R}${R}오나요?`, '돌아오나요?'), true);
  assert.equal(isFaithfulRestore(`title: "嘉義旧監${R}${R} 観光ガイド（4.3★）"`, 'title: "嘉義旧監獄 観光ガイド（4.3★）"'), true);
  assert.equal(isFaithfulRestore(`más informaci${R}${R}n del festival`, 'más información del festival'), true);
  assert.equal(isFaithfulRestore(`${R}、駅から`, '駅、駅から'), true);
  assert.equal(isFaithfulRestore(`a${R}b${R}${R}c`, 'aXbYc'), true);
});

test('refuses any other change, however small', () => {
  assert.equal(isFaithfulRestore(`돌${R}${R}오나요?`, '돌아오나요'), false, 'dropped the ?');
  assert.equal(isFaithfulRestore(`돌${R}${R}오나요?`, '돌아 오나요?'), false, 'added a space elsewhere');
  assert.equal(isFaithfulRestore(`돌${R}${R}오나요?`, '돌오나요?'), false, 'removed the gap instead of filling it');
  assert.equal(isFaithfulRestore(`돌${R}${R}오나요?`, '돌아아아오나요?'), false, 'three letters for one gap');
  assert.equal(isFaithfulRestore(`돌${R}${R}오나요?`, `돌${R}오나요?`), false, 'still broken');
  assert.equal(isFaithfulRestore(`돌${R}${R}오나요?`, '돌 오나요?'), false, 'a space is not a letter');
  assert.equal(isFaithfulRestore(`돌${R}${R}오나요?`, '돌아\n오나요?'), false, 'a line break');
  assert.equal(isFaithfulRestore(`돌${R}${R}오나요?`, undefined), false);
});

test('a lone U+FFFD (August stray) may be removed; a cut letter (two or more) may not', () => {
  assert.equal(isFaithfulRestore(`길거리 음식이나 쇼${R}핑을 즐기기`, '길거리 음식이나 쇼핑을 즐기기'), true);
  assert.equal(isFaithfulRestore(`돌${R}${R}오나요?`, '돌오나요?'), false);
  assert.equal(isFaithfulRestore(`돌${R}${R}${R}오나요?`, '돌아오나요?'), true, 'a 1+2 byte split leaves three');
});

test('a line with nothing broken must come back identical', () => {
  assert.equal(isFaithfulRestore('그대로', '그대로'), true);
  assert.equal(isFaithfulRestore('그대로', '그대로요'), false);
  assert.equal(hasReplacementChar('그대로'), false);
  assert.equal(hasReplacementChar(`그${R}로`), true);
});
