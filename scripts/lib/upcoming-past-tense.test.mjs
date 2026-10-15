// 아직 열리지 않은 행사를 과거형으로 쓴 문장 (2026-10-15).
// 17편이 "took place / was held / played …"로 발행됐다. 잡을 것과 놓아줄 것 양쪽을 고정한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { upcomingPastTense } from './invented-outcomes.mjs';
import { eventPastTense } from './writer.mjs';

test('이번 회차를 과거형으로 보고한 문장은 잡는다', () => {
  for (const s of [
    'Stray Kids World Tour: RUN IT - Hong Kong was held on December 5, 2026, at Kai Tak Stadium.',
    'The BIGBANG Japan Dome Tour - Tokyo played three nights at Tokyo Dome on December 13-15, 2026.',
    '5 Seconds of Summer Jakarta took place at Indonesia Arena on November 14, 2026.',
    'TXT World Tour STEAL THE WIND Macau ran November 20-22, 2026 at Galaxy Arena.',
  ]) assert.equal(upcomingPastTense(s, 2026).length, 1, s);
});

test('현재형·현재완료·다른 해·경기 규칙은 놓아준다', () => {
  for (const s of [
    'The German Masters (Snooker) is played at the Tempodrom from January 25 to 31, 2027.',
    'It is also the first time the group has played the UK, on October 25, 2026.',
    'Matches use the rally-point format: best of three games, each played to 21.',
    'The 2025 edition was held at the same arena.',
    'Stray Kids World Tour: RUN IT - Hong Kong is held on December 5, 2026, at Kai Tak Stadium.',
    'Fans typically arrive an hour before doors on November 14, 2026.',
  ]) assert.equal(upcomingPastTense(s, s.includes('2027') ? 2027 : 2026).length, 0, s);
});

test('연도가 없으면 판정하지 않는다', () => {
  assert.deepEqual(upcomingPastTense('It took place on December 5.', ''), []);
});

test('작성 직후 검사는 모든 필드를 본다', () => {
  const out = { description: 'A concert.', quickAnswer: 'Doors open at 7pm.', body: 'Plain.', faq: [{ q: 'When?', a: 'It was held on December 5, 2026.' }] };
  assert.match(eventPastTense(out, '2026'), /was held/);
  assert.equal(eventPastTense({ ...out, faq: [{ q: 'When?', a: 'It is held on December 5, 2026.' }] }, '2026'), null);
});

// 검증 에이전트 재현 사례(10-15): 다른 해가 함께 나오는 역사, 제목 줄, 한 문장 속 두 번째 동사.
test('다른 해의 역사와 제목 줄은 놓아준다', () => {
  for (const s of [
    'BIGBANG played Tokyo Dome in 2017 and returns there on December 13, 2026.',
    'The festival first ran in 2011; the 2026 edition opens on August 1.',
    'The 2025 edition was held at Olympic Park, while the 2026 festival moves to Jamsil.',
    '## BIGBANG at Tokyo Dome, December 2026\n\nThe group played the dome on its first Japan tour.',
    '## Getting to Kai Tak for the December 2026 show\n\nShuttle buses ran from Kowloon Tong.',
  ]) assert.equal(upcomingPastTense(s, 2026).length, 0, s);
});

test('한 문장의 두 번째 동사도 본다', () => {
  for (const s of [
    'Stray Kids drew a sell-out crowd when the show was held at Gocheok Sky Dome on December 5, 2026.',
    'The 2026 edition sold out in minutes and took place on 5 December.',
    'The tour played Tokyo on December 13-15, 2026.',
    'BABYMONSTER performed three nights at Tokyo Dome in December 2026.',
  ]) assert.equal(upcomingPastTense(s, 2026).length, 1, s);
});

test('경기 이름 뒤 수식어 played는 보고가 아니다', () => {
  assert.equal(upcomingPastTense("The Final is at Suncorp Stadium on 15 November 2026, with the men's and women's finals played on the same day.", 2026).length, 0);
});
