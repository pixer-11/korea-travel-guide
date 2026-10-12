// 성조·악센트 접기는 비교의 양쪽에 똑같이 — 회귀 테스트.
//   node --test scripts/lib/commons-fold.test.mjs
//
// 2026-10-12 사파 발행: 앵커는 "muong"(접힘)인데 파일 제목은 "mường hoa
// valley"(안 접힘)로 비교해서, 좌표까지 맞는 무엉호아 사진 14장이 전부
// 떨어졌다. 베트남어 Đ/đ 는 NFD 로 분해되지 않아 "Đà Lạt" 이 "a lat" 이 됐다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, tokens, heroTitleProblem } from './commons.mjs';

test('fold strips Vietnamese tones and maps Đ/đ to d', () => {
  assert.equal(fold('Mường Hoa'), 'muong hoa');
  assert.equal(fold('Đà Lạt'), 'da lat');
  assert.equal(fold('Tiësto'), 'tiesto');
  assert.deepEqual(tokens('Đà Lạt Night Market'), ['lat', 'night', 'market']);
  assert.ok(tokens('Đồng Văn').includes('dong'));
});

test('a toned file title names an unaccented subject (and the reverse)', () => {
  assert.equal(heroTitleProblem('File:Mường Hoa Valley 06.jpg', 'Muong Hoa Valley'), '');
  assert.equal(heroTitleProblem('File:Muong Hoa Valley 06.jpg', 'Mường Hoa Valley'), '');
});

test('folding does not let a different place through', () => {
  assert.notEqual(heroTitleProblem('File:Hoa Lu ancient capital.jpg', 'Muong Hoa Valley'), '');
});
