// mustInclude 의 "띄어쓰기 무시" 매칭 — 양방향 회귀 테스트.
//   node --test scripts/lib/commons-respaced.test.mjs
//
// 2026-08-09: 커먼즈 파일명은 이름을 붙여 쓴다("LeeHi 2019" vs 우리 제목
// "Lee Hi"). 그래서 mustInclude 는 양쪽에서 공백·밑줄·하이픈을 지우고 비교한다.
// 그 비교가 통째로 붙인 문자열의 substring 검사였던 것이 문제였다.
//
// 2026-08-30: 앵커 "u-know" 가 "Do yo|u know?" 를 통과했다. 붙이면
// "doyouknow" 이고 거기에 "uknow" 가 들어 있기 때문. 그 결과 U-KNOW 글의
// 후보 검색이 스캔 도서 페이지("Do you know? - DPLA -")만 16장 연속으로
// 물어왔고, 자유거절 예산을 전부 태운 뒤 검색이 죽은 것으로 판정돼 멈췄다.
// 비전은 출연자를 구분하지 못하므로, 이런 파일은 게이트가 아니라 검색에서
// 걸러져야 한다.
//
// 고친 규칙은 "한 단어 안에 통째로" 또는 "단어가 시작하는 자리에서 출발".
// 금지되는 것은 한 단어 중간에서 시작해 다음 단어로 넘어가는 매칭 하나뿐이다.
// 아래 두 번째 테스트가 그 좁힘의 대가를 지키는 쪽 — 실제 히어로 854장 중
// 한 장도 잃지 않는다는 것을 대표 사례로 못 박는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containsRespaced } from './commons.mjs';

test('a name may not start in the middle of one word and run into the next', () => {
  // 이것이 이 함수가 존재하는 이유다.
  assert.equal(containsRespaced('Do you know? - DPLA - b994c794 (page 9)', 'u-know'), false);
  assert.equal(containsRespaced('Do you know? - DPLA - 567ff47a (page 4)', 'u-know'), false);
  // 같은 사고의 다른 모양: 앞 단어의 꼬리를 삼키는 매칭.
  assert.equal(containsRespaced('Thank you Kyoto', 'u-kyo'), false);
});

test('every legitimate respelling of a name still matches', () => {
  // 하이픈 그대로.
  assert.equal(containsRespaced('U-Know Yoonho', 'u-know'), true);
  assert.equal(containsRespaced('U-Know Yoon-Ho in 2019', 'u-know'), true);
  // 붙여 쓴 철자.
  assert.equal(containsRespaced('Uknow 251105', 'u-know'), true);
  // 2026-08-09 의 LeeHi — 양방향 모두.
  assert.equal(containsRespaced('Lee Hi at Music Bank', 'leehi'), true);
  assert.equal(containsRespaced('LeeHi 2019', 'lee hi'), true);
  // 카멜케이스로 통째로 붙인 커먼즈 파일명 안에 파묻힌 경우 — 한 단어 안이면
  // 중간에서 시작해도 된다. 이 두 장은 지금 라이브 히어로다.
  assert.equal(containsRespaced('1920px-FranceNormandieLeMontSaintMichelAbbaye', 'mont-saint-michel'), true);
  assert.equal(containsRespaced('HKScienceMuseumview', 'science'), true);
  // 단어 시작에서 출발해 다음 단어 앞부분까지 먹는 것은 허용 — "Hazrat imam"
  // 이 앵커 "hazrati" 를 만족시키는 유일한 길이고, 이것도 라이브 히어로다.
  assert.equal(containsRespaced('3840px-Hazrat imam complex panoramic view', 'hazrati'), true);
  // 하이픈 앵커가 띄어쓰기로 적힌 경우.
  assert.equal(containsRespaced('Al Bithnah Fort, Fujairah, UAE', 'al-bithnah'), true);
  assert.equal(containsRespaced('1920px-Notre Dame Paris front facade lower', 'notre-dame'), true);
  assert.equal(containsRespaced('1920px-Sensoji 2023', 'senso-ji'), true);
});

test('empty needles never match, and nothing throws on odd input', () => {
  assert.equal(containsRespaced('anything', ''), false);
  assert.equal(containsRespaced('anything', '---'), false);
  assert.equal(containsRespaced('', 'x'), false);
  assert.equal(containsRespaced('한글만 있는 제목', 'know'), false);
});
