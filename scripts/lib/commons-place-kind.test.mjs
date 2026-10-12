import test from 'node:test';
import assert from 'node:assert/strict';
import { placeKindOnly, namesPhrase } from './commons.mjs';

// 2026-10-12: "Ulaanbaatar Park" 글에 2.3km 떨어진 국립정원공원 놀이터 사진이 붙었다.
// 이름의 모든 단어(도시+공원)가 남의 공원 파일 이름에도 다 들어 있었다.
test('placeKindOnly: 도시명+장소 종류뿐인 이름은 아무 곳도 특정하지 못한다', () => {
  assert.equal(placeKindOnly('Ulaanbaatar Park', 'Ulaanbaatar'), true);
  assert.equal(placeKindOnly('Hanoi Night Market', 'Hanoi'), true);
  assert.equal(placeKindOnly('Central Square', 'Erdenet'), true);
  assert.equal(placeKindOnly('Grand Palace', 'Bangkok'), true);
});

test('placeKindOnly: 고유한 단어가 하나라도 있으면 해당 없음(기존 규칙 그대로)', () => {
  assert.equal(placeKindOnly('Gyeongbokgung Palace', 'Seoul'), false);
  assert.equal(placeKindOnly('Bogd Khan Palace Museum', 'Ulaanbaatar'), false);
  assert.equal(placeKindOnly('Sükhbaatar Square', 'Ulaanbaatar'), false);
  assert.equal(placeKindOnly('Cloud Gate', 'Chicago'), false);
  assert.equal(placeKindOnly('', 'Hanoi'), false);
});

test('namesPhrase: 이름이 순서대로 붙어 있어야 그 장소다', () => {
  assert.equal(namesPhrase('National Garden Park (Ulaanbaatar) 2', 'Ulaanbaatar Park'), false);
  assert.equal(namesPhrase('Playground at National Garden Park (Ulaanbaatar)', 'Ulaanbaatar Park'), false);
  assert.equal(namesPhrase('Ulaanbaatar Park in summer', 'Ulaanbaatar Park'), true);
  assert.equal(namesPhrase('Ulaanbaatar-park-2019.jpg', 'Ulaanbaatar Park'), true);
  assert.equal(namesPhrase('The Grand Palace, Bangkok', 'Grand Palace'), true);
  assert.equal(namesPhrase('Hanoi night markets', 'Hanoi Night Market'), true);
  assert.equal(namesPhrase('Park in Ulaanbaatar', 'Ulaanbaatar Park'), false);
  // 붙여 쓴 파일 이름도 같은 이름이다(코덱스 지적 재현, 10-13)
  assert.equal(namesPhrase('UlaanbaatarPark.jpg', 'Ulaanbaatar Park'), true);
  assert.equal(namesPhrase('PeoplesHistoryMuseum.JPG', "People's History Museum"), true);
  assert.equal(namesPhrase('NationalGardenPark.jpg', 'Ulaanbaatar Park'), false);
});
