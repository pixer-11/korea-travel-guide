// 글 바이라인 구분점(2026-11-08): 폰 폭에서 점이 줄 끝에 매달리거나 혼자 한 줄을 차지했다.
// 760px 이하에서는 점을 빼고 간격으로 나눈다. 묶음 nowrap 은 쓰면 안 된다 —
// ✓ 문구의 자연 폭이 390px 화면의 본문 폭보다 넓어서 페이지가 옆으로 밀린다.
//   node --test src/styles/post-byline.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./post-layout.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');

const phoneBlocks = [...css.matchAll(/@media \(max-width: 760px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]);

test('at phone width the byline dots are hidden and spacing takes over', () => {
  const block = phoneBlocks.find((b) => b.includes('.post-byline .sep'));
  assert.ok(block, 'no 760px rule for .post-byline .sep');
  assert.match(block, /\.post-byline \.sep \{ display: none; \}/);
  assert.match(block, /\.post-byline \{ column-gap: 0\.75rem; \}/);
});

test('the dots stay on wider screens: the base rule does not hide them', () => {
  const outside = css.replace(/@media[^{]*\{[\s\S]*?\n\}/g, '');
  assert.match(outside, /\.post-byline \.sep \{ color: var\(--line\); \}/);
  assert.doesNotMatch(outside, /\.post-byline \.sep \{[^}]*display: none/);
});

test('nothing in the byline is forced onto one line', () => {
  for (const m of css.matchAll(/\.post-byline[^{]*\{([^}]*)\}/g)) {
    assert.doesNotMatch(m[1], /nowrap/, m[0]);
  }
});
