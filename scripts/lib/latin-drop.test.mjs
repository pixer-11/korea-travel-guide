// 번역기가 단어 대신 그 단어의 영어 뜻풀이를 내놓기 시작했다 (2026-09-07~09).
// 観光 → "observation", 建立 → "completion", 금박 → "golded". 문장은 유창해서
// 기존 검사기가 전부 지나쳤다. 이 검사는 그 한 단어를 잡되, 정상 표기는
// 잡지 않아야 한다 — 오탐이 많은 검사기는 곧 무시당한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { latinDrops } from './latin-drop.mjs';

const drops = (t, l) => latinDrops(t, l).length > 0;

test('CJK 자리에 선 영어 단어를 잡는다', () => {
  assert.ok(drops('浅草寺:東京observation旅行ガイド', 'ja'), '제목에 섞인 것을 놓쳤다');
  assert.ok(drops('阿波羅long廊', 'zh'));
  assert.ok(drops('금박 golded 시대', 'ko'));
});

test('괄호 안이라도 CJK가 섞였으면 잡는다', () => {
  assert.ok(drops('浅草寺(645年completion)へは', 'ja'), '괄호를 통째로 지우면 이게 숨는다');
});

test('🛑 고유명사 병기는 잡지 않는다 — 프롬프트가 시킨 것이다', () => {
  assert.equal(drops('아지만 박물관(Ajman Museum)에서', 'ko'), false);
});

test('🛑 약어·대문자 고유명사에 붙은 조사는 잡지 않는다', () => {
  assert.equal(drops('UAE에서 가장 큰 MTR입니다', 'ko'), false);
});

test('🛑 로마자 주소의 소문자 꼬리는 잡지 않는다', () => {
  assert.equal(drops('186 Jeonseo-ro, Pungcheon-myeon에 있습니다', 'ko'), false, '주소가 오탐이 되면 수백 건이 노이즈가 된다');
  assert.equal(drops('Kamphaeng Phet 2 Rd, Chatuchak district에', 'ko'), false);
});

test('🛑 악센트 단어의 ASCII 꼬리는 잡지 않는다', () => {
  assert.equal(drops('라 데팡스(La Défense에) 근처', 'ko'), false);
});

test('🛑 실제로 쓰는 외래어는 잡지 않는다', () => {
  assert.equal(drops('도쿄의 jazz 바에서', 'ko'), false);
});

test('🛑 스페인어는 아예 대상이 아니다 — 라틴 문자 언어다', () => {
  assert.equal(drops('el observation museo', 'es'), false);
});

test('🛑 멀쩡한 번역은 조용하다', () => {
  assert.equal(drops('浅草寺:東京旅行ガイド', 'ja'), false);
});
