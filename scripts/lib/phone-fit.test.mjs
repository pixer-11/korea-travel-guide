import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pastBy, wordsPastCell, creditCut, monthStripProblems } from './phone-fit.mjs';

const page = (file) => readFileSync(fileURLToPath(new URL(`../../src/components/${file}`, import.meta.url)), 'utf8');

const even = (n, w) => Array.from({ length: n }, () => w);
const spaced = (pitch, width, n = 12) => Array.from({ length: n }, (_, i) => ({ left: i * pitch, right: i * pitch + width }));

test('the 11-09 review numbers are failures', () => {
  // /destinations/japan at 360: December 14.8px past the strip, bars 5.3 to 13.5.
  const bars = [5.3, 7.8, 8, 8.3, 7.7, 8, 7.2, 8, 8, 13.5, 11, 13.5];
  const p = monthStripProblems({ stripRight: 124.4, lastRight: 139.2, bars, labels: spaced(12, 9) });
  assert.equal(p.length, 2);
  assert.match(p[0], /14\.8px/);
  assert.match(p[1], /2\.55/);
  // The methodology rows at 360 and the Spanish tile at 360.
  assert.equal(pastBy(9.9, 0).toFixed(1), '9.9');
  assert.equal(pastBy(109.7, 100).toFixed(1), '9.7');
  // The Japan credit: four pixels, and they are "4.0)".
  assert.equal(creditCut({ scrollWidth: 340, clientWidth: 336 }), true);
});

test('a strip that fits passes, labelled every month or every other month', () => {
  const twelve = { stripRight: 190, lastRight: 190, bars: even(12, 13.1), labels: spaced(16.08, 13.5) };
  assert.deepEqual(monthStripProblems(twelve), []);
  const six = { stripRight: 124.4, lastRight: 124.4, bars: even(12, 7.6), labels: spaced(21.2, 13.5, 6) };
  assert.deepEqual(monthStripProblems(six), []);
});

test('twelve labels squeezed into equal bars are caught, not just a strip that overflows', () => {
  const squeezed = { stripRight: 139.4, lastRight: 139.4, bars: even(12, 8.87), labels: spaced(11.87, 13.5) };
  assert.equal(monthStripProblems(squeezed).length, 1);
  assert.match(monthStripProblems(squeezed)[0], /붙음/);
});

test('rounding is not a defect, on either rule', () => {
  assert.equal(pastBy(100.5, 100), 0);
  assert.equal(pastBy(90, 100), 0);
  assert.equal(creditCut({ scrollWidth: 301, clientWidth: 300 }), false);
  const nudged = { stripRight: 124.4, lastRight: 124.9, bars: [7.6, 7.7, 7.6, 7.7, 7.6, 7.7, 7.6, 7.7, 7.6, 7.7, 7.6, 7.7], labels: spaced(21.2, 13.5, 6) };
  assert.deepEqual(monthStripProblems(nudged), []);
});

test('half a full-width closing mark is not the words leaving their cell', () => {
  assert.equal(wordsPastCell({ right: 353.9, edge: 347.4, text: '福冈圣诞市集（Christmas Advent）', px: 15.2 }), 0);
  // Past that half it is the words again, and a Latin word gets no such allowance.
  assert.ok(wordsPastCell({ right: 360, edge: 347.4, text: '福冈圣诞市集（Christmas Advent）', px: 15.2 }) > 0);
  assert.equal(wordsPastCell({ right: 109.7, edge: 100, text: 'Continentes', px: 12.48 }).toFixed(1), '9.7');
  assert.equal(wordsPastCell({ right: 99, edge: 100, text: 'Continentes', px: 12.48 }), 0);
});

// The sources, so the rules behind the numbers cannot quietly go back.
test('the month strip keeps equal columns and labels every other month while the strip is narrow', () => {
  const hub = page('DestinationHub.astro');
  assert.match(hub, /\.dh-months \{[^}]*repeat\(12, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(hub, /\.dh-months \{[^}]*repeat\(12, 1fr\)/);
  assert.match(hub, /\.dh-cell--best \{[^}]*container-type: inline-size/);
  assert.match(hub, /@container \(max-width: 189px\) \{ \.dh-mo:nth-child\(even\) b \{ visibility: hidden; \} \}/);
});

test('one-line photo credits wrap on a phone instead of losing the licence', () => {
  assert.match(page('DestinationHub.astro'), /@media \(max-width: 760px\) \{ \.dh-credit \{ white-space: normal; text-align: right; \} \}/);
  assert.match(page('RegionHub.astro'), /@media \(max-width: 760px\) \{ \.rh-credit \{[^}]*white-space: normal; text-align: right; \} \}/);
});

test('the methodology rows are held to the card', () => {
  assert.match(page('MethodologyPage.astro'), /\.mt-glance ul \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
});

test('long Spanish labels keep a column they fit in', () => {
  assert.match(page('RegionsIndex.astro'), /\.rg-conts button:lang\(es\) \{ grid-template-columns: 94px 1fr 52px; \}/);
  const post = readFileSync(fileURLToPath(new URL('../../src/styles/post-layout.css', import.meta.url)), 'utf8');
  assert.match(post, /html\[lang\^='es'\] \.side-row \{ grid-template-columns: 5\.5rem minmax\(0, 1fr\); \}/);
});

// 2026-11-13 실서버 정기 검사 오탐: /zh/events 360px 에서 한 줄짜리 행사 이름 끝의 전각 닫는 따옴표.
// 글자 상자는 칸에 정확히 들어가 있었고(오른쪽 319 = 칸 오른쪽 319) 범위 측정만 0.88px 을 더 셌다.
test('wordsPastCell: 한·중·일 글의 닫는 따옴표도 줄 끝에서 절반이 잘린다', () => {
  assert.equal(wordsPastCell({ right: 319.88, edge: 319, text: '阿雷佐“圣诞之城”', px: 16.32 }), 0);
  // 진짜 넘침(반 글자 넘게)은 그대로 잡는다
  assert.ok(wordsPastCell({ right: 335, edge: 319, text: '阿雷佐“圣诞之城”', px: 16.32 }) > 0);
  // 로마자 글의 ” 는 좁은 글자라 잘리지 않는다 — 넘치면 넘친 것이다
  assert.ok(wordsPastCell({ right: 319.88, edge: 319, text: 'Arezzo “City of Christmas”', px: 16.32 }) > 0);
});
