// audit-hours-claims 회귀 테스트.
//
// 이 검사기는 두 번 무고한 글을 격리했다(08-01 '…and closed entirely on
// Tuesday…', 08-04 '…closed every Monday; open Tuesday through Sunday'). 둘 다
// "closed"와 요일 사이에 부사가 끼어 strip이 실패하고, 근처의 다른 요일이
// 범인으로 지목된 사고다. 그래서 오탐(FP) 케이스가 진짜 검출(TP) 케이스만큼
// 중요하다 — 검사기를 손질할 때마다 이 파일을 돌린다.
//   node scripts/audit-hours-claims.test.mjs
import { hoursProblems } from './audit-hours-claims.mjs';

const post = (hours, body, name) => `---
title: T
place:
${name ? `  name: '${name}'
` : ''}  openingHours:
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

// 09-24 시장 세 편의 실데이터.
const AGRA = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((d) => `${d}: 10:00 AM – 8:30 PM`)
  .concat(['Saturday: Closed', 'Sunday: 10:00 AM – 8:30 PM']);
const HAGIANG = ['Monday: 5:00 – 11:30 AM']
  .concat(['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => `${d}: 5:00 AM – 7:00 PM`));
const PORTLAND = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((d) => `${d}: Closed`)
  .concat(['Saturday: 10:00 AM – 5:00 PM', 'Sunday: Closed']);

// 페레즈미술관 실데이터: 화·수 휴관, 목요일만 9시까지.
const PAMM = [
  'Monday: 11:00 AM - 6:00 PM', 'Tuesday: Closed', 'Wednesday: Closed',
  'Thursday: 11:00 AM - 9:00 PM', 'Friday: 11:00 AM - 6:00 PM',
  'Saturday: 11:00 AM - 6:00 PM', 'Sunday: 11:00 AM - 6:00 PM',
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
  // 09-10 량이미술관: 'open Monday to Friday, 10am to 6pm, and closed all weekend' —
  // 부사 목록에 맨 all 이 없어 closed all weekend 의 weekend 가 두 요일로 풀리지 않았고,
  // strip 이 남긴 closed 가 바로 앞의 Friday 와 짝지어져 '금요일 휴관' 오탐이 됐다.
  // 게이트가 격리했고 수리기는 고칠 게 없어 매일 밤 같은 줄을 다시 찍었다 —
  // 08-14 브로모와 완전히 같은 모양이고, 빠진 것은 부사 하나뿐이었다.
  ['FP-closed-all-weekend (should be CLEAN)', post(['Monday: 10:00 AM – 6:00 PM', 'Tuesday: 10:00 AM – 6:00 PM', 'Wednesday: 10:00 AM – 6:00 PM',
     'Thursday: 10:00 AM – 6:00 PM', 'Friday: 10:00 AM – 6:00 PM', 'Saturday: Closed', 'Sunday: Closed'],
    'It is open Monday to Friday, 10am to 6pm, and closed all weekend, so plan a weekday visit.'), 0],
  ['FP-closed-the-whole-weekend (should be CLEAN)', post(['Monday: 10:00 AM – 6:00 PM', 'Tuesday: 10:00 AM – 6:00 PM', 'Wednesday: 10:00 AM – 6:00 PM',
     'Thursday: 10:00 AM – 6:00 PM', 'Friday: 10:00 AM – 6:00 PM', 'Saturday: Closed', 'Sunday: Closed'],
    'It runs Monday to Friday, 10am to 6pm, and is closed the whole weekend.'), 0],
  // 09-14 칸 라 말메종: "1:15pm 에 바로 들어갈 거라 기대하고 가면 거리에 서 있게 된다" —
  // 점심 휴관을 경고하는 정확한 문장. 기대 + 반전이 한 문장에 있을 때만 통과시킨다.
  ['FP-frustrated-expectation (should be CLEAN)', post(SPLIT_DAY,
    "The midday closure catches people off guard. If you arrive at 1pm expecting to walk straight in, you'll be standing outside instead."), 0],
  // 역방향: 반전 없는 "expecting" 은 여전히 권유다.
  ['TP-expecting-without-reversal (must FLAG)', post(SPLIT_DAY,
    'Arrive at 1pm expecting a short queue and an easy wander through the courtyard.'), 1],
  // 역방향: 사실상자가 주말에 열려 있는데 본문이 closed all weekend 라면 계속 잡아야 한다.
  ['TP-closed-all-weekend-but-open (must FLAG)', post(WEEK_OPEN_MON,
    'The market is closed all weekend, so come on a weekday morning instead.'), 1],
  // 09-20 페레즈미술관: 불릿 "- Tuesday and Wednesday: closed entirely" 바로 다음
  // 문단이 "Weekends draw the heaviest crowds…" 로 시작한다. 부사 구간이 줄바꿈을
  // 넘어가는 바람에 주말 치환이 붙어 "closed … Saturday and Sunday" 가 됐고,
  // 사실상자와 완벽히 일치하는 글이 격리됐다. 주장은 줄을 넘지 않는다.
  ['FP-closed-bullet-then-new-paragraph-weekends (should be CLEAN)', post(PAMM,
    ['- Monday, Friday, Saturday, Sunday: 11am-6pm',
     '- Tuesday and Wednesday: closed entirely',
     '',
     'Weekends draw the heaviest crowds, with 11am to 6pm on Saturday and Sunday consistently busy.'].join(String.fromCharCode(10))), 0],
  // 역방향: 같은 줄에 붙어 있으면 그건 진짜 주말 휴무 주장이다.
  ['TP-closed-weekends-same-line (must FLAG)', post(WEEK_OPEN_MON,
    'The hall is closed entirely weekends, so plan a weekday visit.'), 1],
  // 09-20 프놈펜 리버사이드: "closed to cars" 는 차량 통제이지 영업시간이 아니다.
  // 토·일에 열려 있다고 말하는 문장이 토·일 휴무 주장으로 읽혔다.
  ['FP-closed-to-cars (should be CLEAN)', post(WEEK_OPEN_MON,
    "On a Saturday or Sunday you'll find the section that's closed to cars."), 0],
  // 역방향: "closed to the public" 은 진짜 휴무 주장이다.
  ['TP-closed-to-the-public (must FLAG)', post(WEEK_OPEN_MON,
    'The garden is closed to the public on Sunday, so come another day.'), 1],

  // ── 2026-09-24: 한 번의 발행에서 맞게 쓴 시장 글 세 편이 격리됐다 ──
  // (i) 다른 장소가 주어인 휴무 — 아그라 바자르: "타지마할이 금요일에 닫는다".
  ['FP-other-place-subject-taj (should be CLEAN)', post(AGRA,
    'It opens Sunday through Friday. It is closed on Saturday. The Taj Mahal itself is closed on Fridays, so Friday is a natural day for shopping here, and on Fridays, when the Taj is closed, the lanes are quieter.', 'Agra Bazaar'), 0],
  // 역방향: 주어가 이 가게 이름이면 진짜 주장이다.
  ['TP-venue-name-subject (must FLAG)', post(AGRA,
    'Agra Bazaar is closed on Fridays, so plan around it.', 'Agra Bazaar'), 1],
  // 역방향: 대명사 주어는 이 가게다 — 걸러내면 안 된다.
  ['TP-pronoun-subject (must FLAG)', post(AGRA,
    'It is closed on Fridays, so plan around it.', 'Agra Bazaar'), 1],
  // (ii) 반나절 영업일 — 하장 시장: 월요일은 오전만.
  ['FP-short-day-afternoon (should be CLEAN)', post(HAGIANG,
    'Monday is the one that catches people out. If you arrive on the afternoon bus from Hanoi on a Monday, the market will already be closed.'), 0],
  // 역방향: 짧은 날이라도 "closed on Mondays" 라고 못박으면 틀린 주장이다.
  ['TP-short-day-direct (must FLAG)', post(HAGIANG,
    'The market is closed on Mondays, so come another day.'), 1],
  // (iii) 확인 권유 — 포틀랜드 토요시장: "일요일에 가려면 먼저 공식 사이트를 확인하라".
  ['FP-check-before-sunday-visit (should be CLEAN)', post(PORTLAND,
    'It used to run Sundays as well and some listings still say so, so check the official site before planning a Sunday visit.'), 0],
  // 역방향: 닫힌 날을 권하면 여전히 잡는다.
  ['TP-recommend-closed-sunday (must FLAG)', post(PORTLAND,
    'Sunday is the best day to visit, when the stalls are fullest.'), 1],
  // 코덱스 검토(09-24)가 찾은 구멍 셋 — 예외가 진짜 모순까지 숨기면 안 된다.
  // 다른 장소 절을 지울 때 뒤따르는 이 가게의 절까지 지우면 안 된다.
  ['TP-venue-clause-after-other-place (must FLAG)', post(AGRA,
    'The Taj Mahal is closed on Fridays, and the bazaar is closed on Sundays.', 'Agra Bazaar'), 1],
  // "They" 는 이 가게다.
  ['TP-they-subject (must FLAG)', post(AGRA,
    'They are closed on Fridays.', 'Agra Bazaar'), 1],
  // 문장 첫 단어라 대문자일 뿐인 일반명사도 이 가게다.
  ['TP-sentence-start-common-noun (must FLAG)', post(AGRA,
    'Stalls are closed on Fridays.', 'Agra Bazaar'), 1],
  // 다른 장소의 요일 나열은 통째로 그 장소 몫이다.
  ['FP-other-place-day-list (should be CLEAN)', post(AGRA,
    'The Taj Mahal is closed on Fridays and Sundays, which makes those good bazaar days.', 'Agra Bazaar'), 0],
  // 짧은 날이라도 "하루 종일 닫는다" 는 하루 주장이다.
  ['TP-short-day-all-day (must FLAG)', post(HAGIANG,
    'On Monday the market is closed all day.'), 1],
  // 코덱스 2차: 시간 단어가 다른 절(조언)에 있으면 여전히 하루 주장이다.
  ['TP-short-day-time-in-other-clause (must FLAG)', post(HAGIANG,
    'On Monday the market is closed; come back tomorrow morning.'), 1],
  // 코덱스 2차: 느낌표도 문장 끝이다 — 다른 장소 문장을 지우다 다음 문장까지 먹으면 안 된다.
  ['TP-exclamation-ends-other-place (must FLAG)', post(AGRA,
    'The Taj Mahal is closed on Fridays! On Sunday the bazaar is closed.', 'Agra Bazaar'), 1],
];

let fail = 0;
for (const [name, raw, wantMin] of cases) {
  const got = hoursProblems(raw);
  const ok = wantMin === 0 ? got.length === 0 : got.length >= wantMin;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${got.length ? ' — ' + got.join(' | ') : ''}`);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
