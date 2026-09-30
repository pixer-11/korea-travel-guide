import test from 'node:test';
import assert from 'node:assert/strict';
import { eunNeun } from './ko-particle.mjs';

test('받침이 있으면 은, 없으면 는', () => {
  for (const w of ['태국', '베트남', '미국', '일본', '홍콩', '대만', '중국', '스페인']) assert.equal(eunNeun(w), '은', w);
  for (const w of ['싱가포르', '호주', '캄보디아', '인도네시아', '프랑스']) assert.equal(eunNeun(w), '는', w);
});

test('한글이 아니거나 비어도 죽지 않는다', () => {
  assert.equal(eunNeun('Laos'), '는');
  assert.equal(eunNeun(''), '는');
  assert.equal(eunNeun(undefined), '는');
});
