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

// 점심 휴식이 있는 사원 (닥시네스와르 실데이터 형태).
const SPLIT_DAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  .map((d) => `${d}: 5:00 AM – 12:30 PM, 3:30 – 7:30 PM`);
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
  // 08-10 lyon-temple-du-change: 주말만 여는 곳의 정상 본문 —
  //   "- **Saturday**, 3:00–6:00 PM\n- **Sunday**, 10:00–12:30 PM\n\nClosed
  //   the rest of the week." 목록의 Sunday와 다음 문단의 Closed가 마침표 없이
  //   이어져 "일요일 휴관 주장"으로 오탐 → 발행 당일 격리, 수리기는 고칠 게
  //   없었다. 줄바꿈=주장 경계 + "닫는 대상을 스스로 명시한 closed"는 앞
  //   요일과 짝짓지 않는다.
  ['FP-lyon-rest-of-week (should be CLEAN)', post(
    ['Monday: Closed', 'Tuesday: Closed', 'Wednesday: Closed', 'Thursday: Closed', 'Friday: Closed',
     'Saturday: 3:00 – 6:00 PM', 'Sunday: 10:00 AM – 12:30 PM'],
    "It's open only:\n- **Saturday**, 3:00–6:00 PM\n- **Sunday**, 10:00–12:30 PM\n\nClosed the rest of the week. Because the opening window is so narrow, check the schedule first."), 0],
  // 같은 문장 안에 이어져도(줄바꿈 없이) closed가 대상을 스스로 말하면 무죄.
  ['FP-same-sentence-rest-of-week (should be CLEAN)', post(
    ['Monday: Closed', 'Tuesday: Closed', 'Wednesday: Closed', 'Thursday: Closed', 'Friday: Closed',
     'Saturday: 3:00 – 6:00 PM', 'Sunday: 10:00 AM – 12:30 PM'],
    'It is open Saturday afternoons and Sunday mornings and closed the rest of the week, so plan around the weekend.'), 0],
  // 진짜 모순은 여전히 잡혀야 한다: 사실상자엔 일요일이 열려 있는데 본문이
  // "closed Sunday"라고 주장하는 경우.
  ['TP-closed-sunday-still-flags (must FLAG)', post(VEGAS,
    'Note that the gardens are closed Sunday, so weekend visitors should aim for Saturday.'), 1],
  // 08-14 브로모: "…(4:30pm Fridays) and is closed weekends…" — 'weekends'는
  // 토·일 휴관 주장인데 요일 규칙들 눈에는 안 보여서, strip이 남긴 closed가
  // 앞의 Friday와 짝지어져 "금요일 휴관 주장" 오탐 → 발행 당일 격리, 수리기는
  // 고칠 게 없었다. weekends를 두 요일로 풀어 쓰면 기존 규칙이 그대로 처리한다.
  ['FP-bromo-closed-weekends (should be CLEAN)', post(
    ['Monday: 7:30 AM – 4:00 PM', 'Tuesday: 7:30 AM – 4:00 PM', 'Wednesday: 7:30 AM – 4:00 PM',
     'Thursday: 7:30 AM – 4:00 PM', 'Friday: 7:30 AM – 4:30 PM', 'Saturday: Closed', 'Sunday: Closed'],
    'The park itself runs 7:30am to 4pm (4:30pm Fridays) and is closed weekends for entry, so plan a weekday date.'), 0],
  // 역방향: 사실상자엔 토요일이 열려 있는데 본문이 "closed weekends"라고
  // 주장하면 이제는 토·일 각각의 휴관 주장으로 읽혀 잡혀야 한다.
  ['TP-closed-weekends-but-open (must FLAG)', post(WEEK_OPEN_MON,
    'The market is closed weekends, so come on a weekday morning instead.'), 1],
  // 08-14 저녁, 위 브로모 수리의 역풍(고아 해군항공박물관). 'weekends'를 무조건
  // 두 요일로 풀어 쓰면, 휴관과 아무 상관 없이 **다른 동사의 주어**로 쓰인
  // weekends까지 요일이 되어 앞의 휴관 목록에 흡수된다:
  //   "closed Mondays, and weekends fill up between 11am and 5pm"
  //   → "closed Mondays, and Saturday and Sunday fill up…" → 목록 규칙이 토·일도 휴관으로.
  // SCOPE_SHIFT는 요일 뒤 **명사**(hours·crowds…)만 보므로 동사(fill up·get busy)는 못 막는다.
  // 그래서 치환은 closed 바로 뒤(부사만 사이에 둔) weekends에만 적용한다.
  ['FP-goa-weekends-fill-up (should be CLEAN)', post(PALACE,
    "It's closed Mondays, and weekends fill up between 11am and 5pm, so aim for a weekday morning right after the 9:30am opening."), 0],
  // 같은 모양의 다른 동사. 요일이 자기 술어를 가지면 휴관 주장이 아니다.
  ['FP-weekends-get-busy (should be CLEAN)', post(PALACE,
    'The museum is closed Mondays, and weekends get busy between 11am and 5pm.'), 0],
  // 'closed on weekends' — 부사 on이 끼어도 진짜 휴관 주장은 계속 잡혀야 한다.
  ['TP-closed-on-weekends (must FLAG)', post(WEEK_OPEN_MON,
    'The office is closed on weekends, so plan a weekday visit.'), 1],
  // 08-17 닥시네스와르: 점심 휴식(12:30~15:30)이 있는 사원. "arriving at 1pm
  // means a locked gate"는 부정어가 시각 뒤에 오는 정확한 경고 — 발행 당일
  // 격리됐고 수리기는 고칠 게 없었다. 앞 80자만 보던 규칙에 뒤 90자를 추가.
  ['FP-time-then-consequence (should be CLEAN)', post(SPLIT_DAY,
    'The temple keeps a split schedule: 5:00 AM to 12:30 PM, then 3:30 to 7:30 PM. Plan around that gap — arriving at 1pm means a locked gate and a two-hour wait.'), 0],
  // 역방향: 같은 시간표에 "1pm에 오라"는 진짜 잘못된 권유는 여전히 잡혀야.
  ['TP-recommends-closed-hour (must FLAG)', post(SPLIT_DAY,
    'The quietest time to wander the courtyard is around 1pm, when the tour groups have left.'), 1],
  // 부정된 휴무는 안심 문장 — "no awkward closed-Monday surprise" (부하라 타워, 08-20).
  ['FP-negated-closure (should be CLEAN)', post(['Monday: 8:00 AM – 10:00 PM', 'Tuesday: 8:00 AM – 10:00 PM'],
    "The tower is open every day, 8am to 10pm, so there's no awkward closed-Monday surprise to plan around."), 0],
  // 역방향: 진짜 closed-Monday 주장은 여전히 잡는다.
  ['TP-real-closed-claim (must FLAG)', post(['Monday: 8:00 AM – 10:00 PM'],
    'Note that it is closed Monday, so plan your visit for another day.'), 1],
];

let fail = 0;
for (const [name, raw, wantMin] of cases) {
  const got = hoursProblems(raw);
  const ok = wantMin === 0 ? got.length === 0 : got.length >= wantMin;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${got.length ? ' — ' + got.join(' | ') : ''}`);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
