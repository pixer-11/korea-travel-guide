import test from 'node:test';
import assert from 'node:assert/strict';
import { samePlaceKm, ownNameWords } from './commons.mjs';
import { judgeDistance, creditVenue, judgeFoursquareCredit } from './commons-identity.mjs';

// 2026-11-13 픽서님 지시로 장소 글 사진 2,702장을 전수 점검했다. 위키미디어 사진 중
// 촬영 좌표가 있는 1,618장을 재 보니 1,498장이 장소에서 2km 안이었고, 5km 넘게 떨어진
// 59장 중 3분의 1이 "이름만 같은 다른 곳"이었다. 전부 예전 허용 반경 30km 안쪽이다.
test('samePlaceKm: 한 지점짜리 장소는 3km, 넓은 대상은 30km', () => {
  // 실제로 틀렸던 글들 — 전부 한 지점짜리다
  assert.equal(samePlaceKm('Tim Ho Wan (Central)', 'Hong Kong'), 3); // 11km 떨어진 포람점 사진
  assert.equal(samePlaceKm('Din Tai Fung 101', 'Taipei'), 3); // 3.3km 신이루 본점 사진
  assert.equal(samePlaceKm('Templo de Kun Iam', 'Macau Peninsula'), 3); // 타이파의 관음당
  assert.equal(samePlaceKm('MERCADO ARTESANAL DE CUSCO PERÚ', 'Cusco'), 3); // 18km 피삭 시장
  assert.equal(samePlaceKm('Ayutthaya Royal Palace', 'Ayutthaya'), 3); // 20km 방파인 궁전
  assert.equal(samePlaceKm('Taiping Old Street', 'Chiayi'), 3); // 18km 더우류의 동명 거리
  assert.equal(samePlaceKm('National Museum Cardiff', 'Cardiff'), 3); // national 이 붙어도 건물 하나
  assert.equal(samePlaceKm('Stanley Park', 'Vancouver'), 3); // 도심 공원
  // 건물·가게는 이름에 만(bay)·섬이 들어 있어도 한 지점이다(코덱스 지적: 10km 떨어진 다른 틴하우 사원이 통과)
  assert.equal(samePlaceKm('Tin Hau Temple, Causeway Bay', 'Causeway Bay'), 3);
  assert.equal(samePlaceKm('Peyto Lake Viewpoint', 'Lake Louise'), 3);
});

test('samePlaceKm: 국립공원·호수·만·운하·마을 자체는 예전 반경 그대로', () => {
  assert.equal(samePlaceKm('Jasper National Park', 'Jasper'), 30);
  assert.equal(samePlaceKm('Parque Nacional Los Glaciares', 'El Calafate'), 30);
  assert.equal(samePlaceKm('Sai Kung East Country Park', 'Sai Kung'), 30);
  assert.equal(samePlaceKm('Rideau Canal', 'Ottawa'), 30);
  assert.equal(samePlaceKm('Halong Bay', 'Ha Long Bay'), 30);
  assert.equal(samePlaceKm('Colca Canyon', 'Chivay'), 30);
  assert.equal(samePlaceKm('Luli Island', 'Puerto Princesa'), 30);
  assert.equal(samePlaceKm('Nazca Lines', 'Nazca'), 30); // e 로 끝나는 단어의 복수형
  assert.equal(samePlaceKm('Plitvice Lakes', 'Plitvice'), 30);
  assert.equal(samePlaceKm('Tulum', 'Tulum'), 30); // 도시 자체가 대상
  assert.equal(samePlaceKm('Hanoi Old Quarter', 'Hanoi'), 30);
  assert.equal(samePlaceKm('', 'Hanoi'), 30); // 대상을 모르면 좁히지 않는다
});

test('ownNameWords: 도시 이름과 장소 종류를 뺀, 그 장소만의 단어', () => {
  assert.deepEqual(ownNameWords('Cherry', 'Paris'), ['cherry']);
  assert.deepEqual(ownNameWords('The Dome', 'Shanghai'), ['dome']);
  assert.deepEqual(ownNameWords('Hanoi Night Market', 'Hanoi'), []);
  assert.deepEqual(ownNameWords('Ngam Cafe', 'Ho Chi Minh City'), ['ngam']); // 업종 단어는 이름이 아니다(코덱스 지적)
  assert.deepEqual(ownNameWords('Les Deux Magots', 'Paris'), ['deux', 'magot']); // 관사는 세지 않는다
});

test('judgeDistance: 반경 밖이면 far, 좌표가 없으면 판정하지 않는다', () => {
  const tim = { name: 'Tim Ho Wan (Central)', region: 'Hong Kong', lat: 22.2855, lng: 114.1577 };
  assert.equal(judgeDistance({ lat: 22.3225, lng: 114.2577 }, tim).verdict, 'far'); // 포람
  assert.equal(judgeDistance({ lat: 22.2850, lng: 114.1580 }, tim).verdict, 'near');
  assert.equal(judgeDistance({ lat: null, lng: null }, tim).verdict, 'unknown');
  assert.equal(judgeDistance({ lat: 22.3, lng: 114.2 }, { name: 'X', lat: null, lng: null }).verdict, 'unknown');
  assert.equal(judgeDistance({ lat: 0, lng: 0 }, tim).verdict, 'unknown'); // 빈 EXIF
  // 국립공원은 88km 떨어진 봉우리도 그 공원이다 — 30km 반경에서만 far
  const jasper = { name: 'Jasper National Park', region: 'Jasper', lat: 52.873, lng: -117.954 };
  assert.equal(judgeDistance({ lat: 52.95, lng: -118.05 }, jasper).verdict, 'near');
});

test('creditVenue: 이름 안에 괄호가 있어도 가게 이름을 읽는다(465장 중 107장을 못 읽고 있었다)', () => {
  assert.equal(creditVenue('Photo: Foursquare user content (Gangnam Myeonok (강남면옥))'), 'Gangnam Myeonok (강남면옥)');
  assert.equal(creditVenue('Photo: Foursquare user content (3Fils)'), '3Fils');
  assert.equal(creditVenue('Photo: someone'), '');
  // 읽게 되었으니 판정도 나온다: 치폴레 강남 글의 강남면옥
  assert.notEqual(judgeFoursquareCredit('Photo: Foursquare user content (Gangnam Myeonok (강남면옥))', 'Chipotle Gangnam').why, 'credit names no venue');
});
