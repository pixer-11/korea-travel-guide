import test from 'node:test';
import assert from 'node:assert/strict';
import { bannerShaped, BANNER_MAX_ASPECT } from './commons.mjs';

// 2026-11-13 픽서님 검수 지시로 오늘 붙인 사진 96장을 눈으로 봤더니, 가로가 세로의 9배인
// 바르셀로나 띠 파노라마가 16:9 배너 가운데 5분의 1만 늘려 보이고 있었다. 사이트 전체로는
// 1281×105 F1 출발선, 위키보이지용 7:1 띠 배너 4장 등 3.3배를 넘는 대표사진이 25장.
test('bannerShaped: 띠 모양 파노라마는 배너가 될 수 없다', () => {
  assert.equal(bannerShaped(20019, 2269), false); // Skyline Barcelona, December 2025 (8.8:1)
  assert.equal(bannerShaped(1281, 105), false); // 2020 17 ABU Start.png
  assert.equal(bannerShaped(2100, 300), false); // Namangan banner (위키보이지 7:1)
  assert.equal(bannerShaped(5463, 1599), false); // Denpasar dari Duta Plaza (3.42:1)
  assert.equal(bannerShaped(20019, 2269, { allowPortrait: true }), false); // 행사 경로도 같다
});

test('bannerShaped: 보통 가로 사진과 이미 있던 3.1~3.2배 공연·경기장 사진은 그대로 통과', () => {
  assert.equal(bannerShaped(3840, 2560), true);
  assert.equal(bannerShaped(3840, 1367), true); // 2.81:1
  assert.equal(bannerShaped(3917, 1252), true); // Le Sserafim in Tacoma (3.13:1)
  assert.equal(bannerShaped(8947, 2850), true); // Suncorp Stadium (3.14:1)
  assert.equal(bannerShaped(Math.round(1000 * BANNER_MAX_ASPECT), 1000), true); // 경계값은 통과
});

test('bannerShaped: 세로 규칙은 예전 그대로(풍경은 0.95, 행사 인물은 1:1.8까지)', () => {
  assert.equal(bannerShaped(2000, 2400), false);
  assert.equal(bannerShaped(2000, 2400, { allowPortrait: true }), true);
  assert.equal(bannerShaped(1000, 1900, { allowPortrait: true }), false);
  assert.equal(bannerShaped(0, 0), true); // 크기를 모르면 여기서 판정하지 않는다
});
