import test from 'node:test';
import assert from 'node:assert/strict';
import { isStableBackground } from './stable-background.mjs';

// 2026-11-01 웹 대조에서 사실로 확인된 지적들 — 행사·명소 글의 배경 정보
test('행사·명소의 배경 정보(연도·수용인원·멤버·이동시간)는 지적이 아니다', () => {
  assert.equal(isStableBackground('The church was finished in the 1670s.', 'attraction'), true);
  assert.equal(isStableBackground('It holds roughly 2,000 seats.', 'event'), true);
  assert.equal(isStableBackground('The members are Ruka, Pharita, Asa, Ahyeon, Rami, Rora and Chiquita.', 'event'), true);
  assert.equal(isStableBackground('KTX and SRT trains from Seoul reach it in under two hours', 'event'), true);
});

test('가격·시각·메뉴가 들어간 문장은 그대로 지적으로 남는다', () => {
  assert.equal(isStableBackground('Renting a boat costs a modest per-30-minutes fee', 'attraction'), false);
  assert.equal(isStableBackground('a few thousand riel or a small US dollar bill in the donation box', 'attraction'), false);
  assert.equal(isStableBackground('The Metro shuts at around 1:30am.', 'event'), false);
  assert.equal(isStableBackground('weekends between 7am and 11am', 'attraction'), false);
  assert.equal(isStableBackground('one evening typically staying open later than the others', 'attraction'), false);
  assert.equal(isStableBackground('the dish most visitors order', 'event'), false);
});

// 코덱스 검토(11-02)가 찾은 구멍 — 면제되면 안 되는 것
test('목록에 없는 통화 코드·점 시각·숫자 범위 시간·노점 요리·최근 연도는 지적으로 남는다', () => {
  assert.equal(isStableBackground('Tickets are 20 SGD', 'event'), false);
  assert.equal(isStableBackground('AED 50 at the gate', 'attraction'), false);
  assert.equal(isStableBackground('9–5 daily', 'attraction'), false);
  assert.equal(isStableBackground('09.00–17.00', 'attraction'), false);
  assert.equal(isStableBackground('The stall offers nasi goreng and satay', 'event'), false);
  assert.equal(isStableBackground('credited to Café Central on the plaza', 'event'), false);
  assert.equal(isStableBackground('the large mall that opened in 2024 beside the sports complex', 'event', 2026), false);
  assert.equal(isStableBackground('The venue opened in 2020 and holds roughly 8,000.', 'event', 2026), false);
});

test('시간 범위처럼 보여도 분·거리는 배경 정보다', () => {
  assert.equal(isStableBackground('about 15–20 minutes from the airport', 'event'), true);
  assert.equal(isStableBackground('KTX and SRT trains from Seoul reach it in under two hours', 'event'), true);
  assert.equal(isStableBackground('The theatre opened in 1866', 'attraction', 2026), true);
});

test('식당·카페·숨은명소 글은 배경처럼 보여도 전부 지적으로 남는다', () => {
  // 작은 가게 글에서 요리 이름은 지어낸 메뉴일 수 있다 — 원래 규칙의 대상
  assert.equal(isStableBackground('Har gow, siu mai and char siu bao are the classic opening round.', 'hidden-gem'), false);
  assert.equal(isStableBackground('The building opened in 1865.', 'restaurant'), false);
  assert.equal(isStableBackground('The building opened in 1865.', 'trendy'), false);
});

test('빈 인용은 면제하지 않는다', () => {
  assert.equal(isStableBackground('', 'event'), false);
  assert.equal(isStableBackground(undefined, 'attraction'), false);
});

test('코덱스 2차 검토(11-02): 통화 없는 가격·소문자 코드·운영시간 표현·serving 도 남는다', () => {
  assert.equal(isStableBackground('Tickets are 20 per person', 'event'), false);
  assert.equal(isStableBackground('20 bdt per person', 'attraction'), false);
  assert.equal(isStableBackground('daily from 10 to 18', 'attraction'), false);
  assert.equal(isStableBackground('runs 24/7', 'attraction'), false);
  assert.equal(isStableBackground('Serving nasi goreng', 'event'), false);
  // 분 단위 범위는 여전히 배경 정보
  assert.equal(isStableBackground('Allow 30 to 45 minutes for the halls', 'attraction'), true);
  assert.equal(isStableBackground('seating roughly 15,000 to 20,000 depending on the stage', 'event'), true);
});
