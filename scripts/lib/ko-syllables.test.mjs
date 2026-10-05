import test from 'node:test';
import assert from 'node:assert/strict';
import { koBrokenSyllables, koMangledSyllables } from './ko-syllables.mjs';

test('catches the mangled 쯤 the owner found on a live page', () => {
  const hits = koBrokenSyllables('이곳을 5분짜리 사진 촬영 장소쯽으로 여기는 것입니다');
  assert.equal(hits.length, 1);
  assert.match(hits[0], /^쯽 — /);
});

test('leaves ordinary Korean prose alone', () => {
  assert.deepEqual(koBrokenSyllables('오전 중반쯤 부뇰에 도착합니다. 사람들과 몸을 부딪히며 다녀야 한다.'), []);
});

test('allows the loanword syllables Thai and Vietnamese names need', () => {
  assert.deepEqual(koBrokenSyllables('똠얌꿍과 왓 쩻 욧, 프라웻 지구'), []);
});

test('allows 베르됭 (Verdun), the standard spelling the Cologne posts use (10-03)', () => {
  assert.deepEqual(koBrokenSyllables('금세공인 베르됭의 니콜라가 1190년에 만들었다'), []);
});

test('the write gate reads every field, not just the body', () => {
  const out = {
    title: '깨끗한 제목',
    description: '깨끗한 설명',
    quickAnswer: '20분쯍 앉아서',
    body: '중간쯀 지점에서',
    faq: [{ q: '퍁레이드는 언제인가요?', a: '깨끗한 답변' }],
  };
  assert.deepEqual(koMangledSyllables(out).sort(), ['쯀', '쯍', '퍁'].sort());
});

test('the write gate stays quiet on a clean translation', () => {
  assert.deepEqual(koMangledSyllables({ title: '부산 타워', body: '오전 중반쯤', faq: [{ q: '가는 법', a: '지하철' }] }), []);
});

test('the same broken syllable twice is reported once', () => {
  assert.deepEqual(koMangledSyllables({ title: '장소쯽', body: '장소쯽으로' }), ['쯽']);
});

test('됭 is allowed only inside 베르됭 — 됭장 is still a typo (Codex, 10-03)', () => {
  assert.deepEqual(koBrokenSyllables('됭장찌개'), ['됭 — 됭장찌개']);
});

test('allows 아녤리 (Agnelli) — the fixer deleted the Turin translation for it every publish (10-05)', () => {
  assert.deepEqual(koBrokenSyllables('옥상에 오르면 아녤리 미술관과 라 피스타'), []);
});
