// meta-social 회귀 테스트 — 자동 게시의 순수 부품을 고정한다.
//
//   node --test scripts/lib/meta-social.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptStore, decryptStore, pickThreadsOption, threadsText, isIgDay } from './meta-social.mjs';
import { createHash } from 'node:crypto';

const KEY = createHash('sha256').update('테스트키:wander-atlas-social-token').digest();

test('토큰 금고: 암호화 왕복 + 틀린 키는 실패', () => {
  const obj = { ig: { token: 'IGAAR...x', refreshedAt: '2026-08-27T05:00:00Z' }, th: { token: 'THAA...y', refreshedAt: '2026-08-27T05:00:00Z' } };
  const raw = encryptStore(obj, KEY);
  assert.deepEqual(decryptStore(raw, KEY), obj);
  const wrong = createHash('sha256').update('다른키').digest();
  assert.throws(() => decryptStore(raw, wrong));
});

test('스레드 문구: C(질문형) 우선, KO 줄은 섞이지 않는다', () => {
  const part = 'A: Tip text here.\nKO: 팁 요약\nB: Hook text.\nKO: 훅 요약\nC: Would you climb at dawn?\nKO: 질문 요약';
  assert.equal(pickThreadsOption(part), 'Would you climb at dawn?');
});

test('스레드 문구: C가 없으면 B→A로 물러선다', () => {
  assert.equal(pickThreadsOption('A: Only a tip.\nKO: 팁'), 'Only a tip.');
  assert.equal(pickThreadsOption('A: Tip.\nKO: 팁\nB: The hook.\nKO: 훅'), 'The hook.');
});

test('스레드 문구: 링크 포함 500자 상한을 절대 넘지 않는다', () => {
  const url = 'https://wanderatlasguides.com/posts/some-place/';
  const t = threadsText('x'.repeat(600), url);
  assert.ok(t.length <= 500, `${t.length}자`);
  assert.ok(t.endsWith(url));
});

test('인스타 요일: 월·수·금(KST)만 참', () => {
  // 2026-08-24 = 월요일
  const kst = (d) => new Date(Date.parse(d + 'T12:00:00+09:00') + 9 * 3600e3);
  assert.equal(isIgDay(kst('2026-08-24')), true);  // 월
  assert.equal(isIgDay(kst('2026-08-25')), false); // 화
  assert.equal(isIgDay(kst('2026-08-26')), true);  // 수
  assert.equal(isIgDay(kst('2026-08-27')), false); // 목
  assert.equal(isIgDay(kst('2026-08-28')), true);  // 금
  assert.equal(isIgDay(kst('2026-08-29')), false); // 토
});
