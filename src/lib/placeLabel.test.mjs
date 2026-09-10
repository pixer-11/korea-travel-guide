// 목록은 장소를 보여주는 자리인데 기사 제목이 새어 나왔다 (2026-09-10 실측:
// zh 는 when-to-go 120개 중 80개, 일정표 50개 중 42개). 영어·스페인어는 0건이라
// 아무도 몰랐다 — ASCII 콜론만 나누고 있었고 CJK 는 전각 ：를 쓰거나 구분자 없이
// 접미사를 붙이기 때문이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shortPlaceLabel } from './placeLabel.mjs';

test('구분자 없이 붙은 접미사를 뗀다', () => {
  assert.equal(shortPlaceLabel('東京タワー旅行ガイド', 'ja'), '東京タワー');
  assert.equal(shortPlaceLabel('东京塔旅行指南', 'zh'), '东京塔');
  assert.equal(shortPlaceLabel('나라 공원(Nara Park) 여행 가이드', 'ko'), '나라 공원(Nara Park)');
});

test('전각 구분자에서 나눈다 — ASCII 콜론만 보면 이걸 놓친다', () => {
  assert.equal(shortPlaceLabel('巴戎寺：暹粒旅行指南（4.8星）', 'zh'), '巴戎寺');
});

test('뒤에 붙은 평점은 폭이 달라도 뗀다', () => {
  assert.equal(shortPlaceLabel('카통 파크 여행 가이드 (4.1★)', 'ko'), '카통 파크');
  assert.equal(shortPlaceLabel('スーパーツリー・グローブ完全ガイド：マリーナベイ観光(評価4.7★)', 'ja'), 'スーパーツリー・グローブ');
});

test('영어와 스페인어는 전과 같이 동작한다 (회귀 방지)', () => {
  assert.equal(shortPlaceLabel('Tokyo Tower: Tokyo Travel Guide (4.5★)', 'en'), 'Tokyo Tower');
  assert.equal(shortPlaceLabel('Torre de Tokio: Guía de viaje', 'es'), 'Torre de Tokio');
});

test('🛑 이름 전체를 지우지 않는다 — 접미사만으로 이루어진 이름', () => {
  assert.equal(shortPlaceLabel('가이드', 'ko'), '가이드');
  assert.equal(shortPlaceLabel('ガイド', 'ja'), 'ガイド');
});

test('🛑 접미사가 없으면 그대로 둔다', () => {
  assert.equal(shortPlaceLabel('東京タワー', 'ja'), '東京タワー');
  assert.equal(shortPlaceLabel('Bayon Temple', 'en'), 'Bayon Temple');
});

test('빈 값에도 죽지 않는다', () => {
  assert.equal(shortPlaceLabel(undefined, 'ko'), '');
  assert.equal(shortPlaceLabel('', 'ja'), '');
});
