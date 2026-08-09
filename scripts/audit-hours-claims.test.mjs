// audit-hours-claims 회귀 테스트.
//
// 이 검사기는 두 번 무고한 글을 격리했다(08-01 '…and closed entirely on
// Tuesday…', 08-04 '…closed every Monday; open Tuesday through Sunday'). 둘 다
// "closed"와 요일 사이에 부사가 끼어 strip이 실패하고, 근처의 다른 요일이
// 범인으로 지목된 사고다. 그래서 오탐(FP) 케이스가 진짜 검출(TP) 케이스만큼
// 중요하다 — 검사기를 손질할 때마다 이 파일을 돌린다.
//   node scripts/audit-hours-claims.test.mjs
import { hoursProblems } from './audit-hours-claims.mjs';

const post = (hours, body) => `---
title: T
place:
  openingHours:
${hours.map((h) => `    - '${h}'`).join('\n')}
---
${body}`;

const WEEK_OPEN_MON = [
  'Monday: 9:00 AM – 2:00 PM', 'Tuesday: 9:00 AM – 2:00 PM', 'Wednesday: 9:00 AM – 2:00 PM',
  'Thursday: 9:00 AM – 2:00 PM', 'Friday: 9:00 AM – 2:00 PM', 'Saturday: 9:00 AM – 2:00 PM', 'Sunday: 9:00 AM – 2:00 PM',
];
const VEGAS = [
  'Monday: 9:00 AM – 4:00 PM', 'Tuesday: Closed', 'Wednesday: Closed',
  'Thursday: 9:00 AM – 4:00 PM', 'Friday: 9:00 AM – 4:00 PM', 'Saturday: 9:00 AM – 4:00 PM', 'Sunday: 9:00 AM – 4:00 PM',
];
const FORT = [
  'Monday: 10:00 AM – 5:00 PM', 'Tuesday: Closed', 'Wednesday: Closed',
  'Thursday: 10:00 AM – 5:00 PM', 'Friday: 10:00 AM – 5:00 PM', 'Saturday: 10:00 AM – 5:00 PM', 'Sunday: 10:00 AM – 5:00 PM',
];
// 자금성: 월요일만 휴관, 화~일 개관 — 'closed every Monday'가 참인 배치.
const PALACE = [
  'Monday: Closed', 'Tuesday: 8:30 AM – 4:30 PM', 'Wednesday: 8:30 AM – 4:30 PM',
  'Thursday: 8:30 AM – 4:30 PM', 'Friday: 8:30 AM – 4:30 PM', 'Saturday: 8:30 AM – 4:30 PM', 'Sunday: 8:30 AM – 4:30 PM',
];

const cases = [
  ['FP-vegas (should be CLEAN)', post(VEGAS,
    'open 9am to 4pm Monday, Thursday, Friday, Saturday, and Sunday, and closed entirely on Tuesday and Wednesday. Arrive at opening.'), 0],
  ['FP-fort (should be CLEAN)', post(FORT,
    'The fort is open Thursday through Monday, 10am to 5pm, and closed both Tuesday and Wednesday — plan around that.'), 0],
  // 08-04 자금성: 'closed every Monday' 뒤에 Sunday가 이어지는 정상 문장.
  ['FP-forbidden-city (should be CLEAN)', post(PALACE,
    "Open Tuesday through Sunday, 8:30am to 4:30pm. Yes, it's closed every Monday; it's open Tuesday through Sunday from 8:30am to 4:30pm."), 0],
  // 08-08 MNAC: 'closed on Mondays, and Sunday hours tend to be shorter' — 두
  // 절이지 "월·일 휴관" 목록이 아니다. 'Sunday hours'처럼 요일이 다른 명사를
  // 꾸미면 그 요일은 휴관 주장의 대상이 아니다.
  ['FP-mnac-sunday-hours (should be CLEAN)', post(PALACE,
    'The museum is closed on Mondays, and Sunday hours tend to be shorter than other days, so confirm the schedule.'), 0],
  ['FP-partial-sunday (should be CLEAN)', post(PALACE,
    'It is closed Monday and Sunday mornings, opening at noon on the weekend.'), 0],
  ['TP-museo (must FLAG)', post(WEEK_OPEN_MON,
    'The museum is closed on Mondays, so plan a Tuesday visit.'), 1],
  ['TP-adverb-list (must FLAG)', post(WEEK_OPEN_MON,
    'It is closed both Monday and Tuesday, so aim for the weekend.'), 1],
  ['TP-clock (must FLAG)', post(VEGAS,
    'Stay for the lights at 8pm before heading back to the Strip.'), 1],
  // 08-09 Hollyhock House: 'closed Sunday through Wednesday, so plan your
  // itinerary around that narrow window' is correct prose — the negation sits
  // BEFORE the day, which the after-text-only check missed.
  ['FP-closed-through (should be CLEAN)', post(FORT,
    "It's closed Tuesday and Wednesday, so plan your visit for Thursday through Monday instead."), 0],
  ['FP-closed-range-before-day (should be CLEAN)', post(
    ['Monday: Closed', 'Tuesday: Closed', 'Wednesday: Closed', 'Thursday: 11:00 AM - 4:00 PM', 'Friday: 11:00 AM - 4:00 PM', 'Saturday: 11:00 AM - 4:00 PM', 'Sunday: Closed'],
    "It's closed Sunday through Wednesday, so plan your LA itinerary around that narrow window."), 0],
  ['TP-suggest-closed-day (must FLAG)', post(VEGAS,
    'A Tuesday morning visit is the quietest way to see the gardens.'), 1],
];

let fail = 0;
for (const [name, raw, wantMin] of cases) {
  const got = hoursProblems(raw);
  const ok = wantMin === 0 ? got.length === 0 : got.length >= wantMin;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${got.length ? ' — ' + got.join(' | ') : ''}`);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
