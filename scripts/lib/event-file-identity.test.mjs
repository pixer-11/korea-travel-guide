// 이벤트 히어로 파일명 신원 검사 — 양방향 회귀 테스트.
// 2026-08-22: 장소(venue) 검색이 찾아온 12편 전부가 "다른 출연자"로 버려졌다
// ("remote view", "exterior", "aerial view"가 출연자 이름으로 읽혔다). 반대로
// 진짜 다른 출연자("Mayday … Concert", "Cirque du Soleil")는 계속 막혀야 한다.
//   node scripts/lib/event-file-identity.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foreignInFilename, geoTokens } from './event-file-identity.mjs';
import { tokens } from './commons.mjs';

const U = (f) => `https://upload.wikimedia.org/wikipedia/commons/a/b/${encodeURIComponent(f)}`;
const known = (...parts) => new Set(parts.flatMap((p) => tokens(p)));

test('venue finds: scene words are not another act', () => {
  const k = known('PLK Stade de France Concerts', 'Paris', 'France', 'Stade de France');
  assert.equal(foreignInFilename(U('Remote_view_of_Stade_de_France_(49445778188).jpg'), { known: k, via: 'venue' }), '');
  const k2 = known('EDC Korea', 'Incheon', 'South Korea', 'INSPIRE Entertainment Resort');
  assert.equal(foreignInFilename(U('3840px-Inspire_Entertainment_Resort_Exterior.jpg'), { known: k2, via: 'venue' }), '');
  const k3 = known('Formula 1 United States Grand Prix', 'Austin', 'United States', 'Circuit of the Americas');
  assert.equal(foreignInFilename(U('3840px-Circuit_of_the_Americas_aerial_view_from_WN4430.jpg'), { known: k3, via: 'venue' }), '');
  const k4 = known('Vietnamese Super Cup', 'Hanoi', 'Vietnam', 'Hàng Đẫy Stadium');
  assert.equal(foreignInFilename(U('Hang_Day.jpg'), { known: k4, via: 'venue' }), '');
});

test('venue finds: another act at the venue is still refused', () => {
  const k = known('Official HIGE DANDism Asia Tour', 'Taipei', 'Taiwan', 'Taipei Dome');
  assert.notEqual(foreignInFilename(U('3840px-Mayday_Taipei_Dome_Concert.jpg'), { known: k, via: 'venue' }), '');
  const k2 = known('PLK Stade de France Concerts', 'Paris', 'France', 'Stade de France');
  assert.notEqual(foreignInFilename(U('Central_Tour_Indochine_Paris_Stade_de_France.jpg'), { known: k2, via: 'venue' }), '');
  const k3 = known('Formula 1 United States Grand Prix', 'Austin', 'United States', 'Circuit of the Americas');
  assert.notEqual(foreignInFilename(U('Cirque_du_Soleil_at_Circuit_of_the_Americas_2015.jpg'), { known: k3, via: 'venue' }), '');
});

test('phrase finds: the event name itself passes, a sibling event does not', () => {
  const k = known('Hue Festival 2026 - Autumn Festival', 'Hue', 'Vietnam');
  assert.equal(foreignInFilename(U('Festival_Huế.jpg'), { known: k, via: 'phrase' }), '');
  const k2 = known('Asian Games 2026', 'Nagoya', 'Japan');
  assert.notEqual(foreignInFilename(U('3840px-Penutupan_Para_Asian_Games_2018.jpg'), { known: k2, via: 'phrase' }), '');
  // A past host city is WHERE, not WHO — but only with the geo set, and only
  // for phrase/venue finds.
  const geo = geoTokens({ regions: ['Hangzhou', 'Nagoya'], countries: ['China', 'Japan'] });
  assert.equal(foreignInFilename(U('Hangzhou_2022_Asian_Games_opening.jpg'), { known: k2, via: 'phrase', geo }), '');
  assert.notEqual(foreignInFilename(U('Hangzhou_2022_Asian_Games_opening.jpg'), { known: k2, via: 'phrase' }), '');
  assert.notEqual(foreignInFilename(U('Hangzhou_2022_Asian_Games_opening.jpg'), { known: k2, anchor: '', geo }), '');
});

test('act finds keep the strict rule (the Post Malone / F1 Rocks case)', () => {
  const k = known('Post Malone – BIG ASS World Tour', 'Singapore', 'Singapore');
  assert.notEqual(foreignInFilename(U('F1_Rocks_Singapore.jpg'), { known: k, anchor: 'malone' }), '');
  assert.equal(foreignInFilename(U('Post_Malone_at_Rolling_Loud_2019.jpg'), { known: k, anchor: 'malone' }), '');
  const k2 = known('F✦FOREVER Tour', 'Seoul', 'South Korea');
  assert.notEqual(foreignInFilename(U('After_Forever_Circo_Voador.jpg'), { known: k2, anchor: 'forever' }), '');
});
