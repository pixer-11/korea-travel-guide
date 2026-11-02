// 끝난 행사를 아직 현재형으로 알리는 문장 (2026-11-02).
// 끝난 266편 중 30여 편의 요약문이 "takes place … on November 1, 2026"로 남아 있었고,
// 번역이 그 문장을 "열립니다"로 옮겨 번역 시제 감사가 매일 걸렸다. 잡을 것과 놓아줄 것 양쪽을 고정한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { endedPresentTense } from './invented-outcomes.mjs';

test('이번 회차 일정을 현재형으로 알리는 문장은 잡는다', () => {
  for (const s of [
    'The JTBC Seoul Marathon takes place in Seoul on November 1, 2026.',
    'The MAMAMOO 4WARD Tour comes to Hong Kong at Kai Tak Arena in 2026.',
    'On October 31, 2026, that show comes to the Alhambra in Paris.',
    'Jason Mraz Manila 2026 is set for October 27, 2026 at SM Mall of Asia Arena.',
    'The Hangang River Festival runs from Saturday, October 17 to Sunday, October 25, 2026.',
    'The Kovacs Tbilisi Concert takes place on October 24 at Republic Event Hall.',
  ]) assert.equal(endedPresentTense(s, 2026, 10).length + endedPresentTense(s, 2026, 11).length >= 1, true, s);
});

test('과거형·관습·다른 해·장소 아닌 "comes to"·명사 "return"은 놓아준다', () => {
  for (const s of [
    'The marathon was set for November 1, 2026 in Seoul.',
    'Jason Mraz was set to return to Bangkok on Thursday, October 29, 2026.',
    "It was the group's first return to Singapore since 2024, on September 30, 2026.",
    'On October 15 this is where Phnom Penh comes to remember him.',
    'The Hoi An Lantern Festival is held on the 14th day of every lunar month.',
    'The 2025 edition takes place in the archive photos from October 3, 2025.',
    'The stadium is held up by four steel arches.',
    'The race takes place on a flat, fast course.',
  ]) assert.equal(endedPresentTense(s, 2026, 10).length, 0, s);
});

// 코덱스 검토(11-02)에서 나온 경우들.
test('날짜가 뒤따르지 않는 runs/set for는 일정이 아니다', () => {
  for (const s of [
    'The 2026 marathon course runs from City Hall to the river.',
    'The 2026 festival site is set for redevelopment next year.',
  ]) assert.equal(endedPresentTense(s, 2026, 10).length, 0, s);
  assert.equal(endedPresentTense('The 2026 event is set to take place in Seoul on November 1.', 2026, 11).length, 1);
});

test('달을 넘는 행사는 끝나는 달의 날짜도 본다', () => {
  const s = 'The festival takes place on December 1 at the riverside.';
  assert.equal(endedPresentTense(s, 2026, 11).length, 0);
  assert.equal(endedPresentTense(s, 2026, [11, 12]).length, 1);
});

test('연도가 없으면 판정하지 않는다', () => {
  assert.deepEqual(endedPresentTense('It takes place on October 5.', '', 10), []);
});
