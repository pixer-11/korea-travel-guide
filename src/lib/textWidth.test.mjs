import test from 'node:test';
import assert from 'node:assert/strict';
import { displayWidth, fitsWidth } from './textWidth.mjs';

test('Latin counts one unit per character', () => {
  assert.equal(displayWidth('Wander Atlas'), 12);
  assert.equal(displayWidth(''), 0);
  assert.equal(displayWidth(undefined), 0);
});

test('CJK counts two units per character', () => {
  assert.equal(displayWidth('서울'), 4);       // hangul syllables
  assert.equal(displayWidth('東京'), 4);       // han
  assert.equal(displayWidth('とうきょう'), 10); // hiragana
  assert.equal(displayWidth('トウキョウ'), 10); // katakana
});

test('mixed strings add up', () => {
  // "Seoul 서울" = 5 Latin + 1 space + 2 hangul = 6 + 4
  assert.equal(displayWidth('Seoul 서울'), 10);
});

test('CJK punctuation and fullwidth forms are wide', () => {
  assert.equal(displayWidth('、'), 2);
  assert.equal(displayWidth('（）'), 4);
  // ASCII parentheses are not
  assert.equal(displayWidth('()'), 2);
});

test('an astral character counts once, not twice', () => {
  // U+20000, CJK extension B — two UTF-16 code units, one character, width 2.
  const astral = String.fromCodePoint(0x20000);
  assert.equal(astral.length, 2, 'precondition: surrogate pair');
  assert.equal(displayWidth(astral), 2);
});

test('the real defect: a Korean title that passed .length now fails on width', () => {
  const title = '크리스티나 아길레라 라이브: 알아야 할 것들 (아부다비) · Wander Atlas';
  assert.ok(title.length <= 60, `precondition: .length says ${title.length}, so the old rule allowed it`);
  assert.ok(displayWidth(title) > 60, `width is ${displayWidth(title)} — should exceed the ceiling`);
});

test('an English title of the same character count still fits', () => {
  const title = 'Christina Aguilera Live: What to Know (Abu Dhabi)';
  assert.ok(fitsWidth(title, 60), `width ${displayWidth(title)}`);
});

test('fitsWidth is inclusive at the boundary', () => {
  assert.equal(fitsWidth('a'.repeat(60), 60), true);
  assert.equal(fitsWidth('a'.repeat(61), 60), false);
  assert.equal(fitsWidth('가'.repeat(30), 60), true);
  assert.equal(fitsWidth('가'.repeat(31), 60), false);
});
