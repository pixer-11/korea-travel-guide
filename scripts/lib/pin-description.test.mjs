import test from 'node:test';
import assert from 'node:assert/strict';
import { pinDescription, friendlyHours, openingHook, isPerishable, tidyClock, uniformHours, offersLine, parseDayLines, hasSpecificDate } from './pin-description.mjs';
import { quietWindowSummaryWithinHours, dayGroupLabel } from './quiet-window.mjs';
import { openHourSetsByDay, quietDayGroups } from '../../src/lib/hours.mjs';

const POST = {
  title: 'Fushimi Inari Taisha: Kyoto Travel Guide (4.7★)',
  description: 'Fushimi Inari Taisha is a Shinto shrine at the base of Mount Inari, famous for thousands of vermilion torii gates.',
  region: 'Kyoto',
  country: 'Japan',
  place: {
    name: 'Fushimi Inari Taisha',
    rating: 4.7,
    userRatingsTotal: 62208,
    busyness: { weekdayQuiet: [7, 8], weekendQuiet: [7] },
  },
};

test('한산한 시간이 맨 앞에 온다 — 우리만 가진 사실', () => {
  const d = pinDescription(POST);
  assert.match(d, /^Quietest weekdays 7-9am/);
});

// The publisher always hands the guide's body over; these assertions do too,
// because what the pin offers is now read out of the body (2026-09-21).
const BODY = [
  '## Getting there',
  'Inari Station is two minutes away.',
  '',
  '## When to go',
  'Before 8am the gates are empty.',
].join('\n');

test('장소·지역·평점·실용 정보가 순서대로 들어간다', () => {
  const d = pinDescription(POST, BODY);
  assert.match(d, /Fushimi Inari Taisha in Kyoto, Japan\./);
  assert.match(d, /4\.7★ from 62,208 visitors\./);
  assert.match(d, /How to get there and when to go to beat the crowds./);
  assert.doesNotMatch(d, /Opening hours/, 'no hours in this post, so none promised');
});

test('검색어 해시태그가 꼬리에 붙고 500자를 넘지 않는다', () => {
  const d = pinDescription(POST);
  assert.match(d, /#Kyoto #Japan #ThingsToDoInKyoto$/);
  assert.ok(d.length <= 500, `length ${d.length}`);
});

test('혼잡 데이터가 없으면 첫 문장으로 채우고, 평점이 얇으면 숫자를 쓰지 않는다', () => {
  const d = pinDescription({ ...POST, quickAnswer: undefined, place: { name: 'Somewhere', rating: 4.9, userRatingsTotal: 12 } });
  assert.doesNotMatch(d, /Quietest/);
  assert.doesNotMatch(d, /4\.9★/);
  assert.match(d, /Shinto shrine at the base of Mount Inari/);
});

test('구글용 메타 설명을 그대로 쓰지 않는다 (2026-09-16 변경의 요점)', () => {
  const d = pinDescription(POST);
  assert.ok(!d.startsWith(POST.description.slice(0, 40)), 'pin must not open with the Google meta description');
});

test('시간 표기는 사람이 읽는 방식으로 바뀐다', () => {
  assert.equal(friendlyHours('weekdays 7:00-8:00, weekends 19:00-23:00'), 'weekdays 7-8am, weekends 7-11pm');
  assert.equal(friendlyHours(null), null);
});

// ── 2026-09-21: the hook ladder ──────────────────────────────
// Measured on the 40 newest pins: only 10 opened with a quiet window, so three
// pins in four led with the venue name — the one sentence every other travel
// site also has. Each rung below is a fact already verified in frontmatter.

test('한산한 시간이 없으면 휴무일이 훅이 된다', () => {
  const d = pinDescription({
    title: 'BAPS Hindu Mandir', region: 'Abu Dhabi', country: 'United Arab Emirates',
    place: {
      name: 'BAPS Hindu Mandir',
      openingHours: ['Monday: Closed', 'Tuesday: 9:00 AM – 8:00 PM', 'Wednesday: 9:00 AM – 8:00 PM',
        'Thursday: 9:00 AM – 8:00 PM', 'Friday: 9:00 AM – 8:00 PM', 'Saturday: 9:00 AM – 8:00 PM',
        'Sunday: 9:00 AM – 8:00 PM'],
    },
  });
  assert.match(d, /^Closed Mondays\./);
});

test('일주일 내내 같은 영업시간이면 그것이 훅이 된다', () => {
  const hours = Array.from({ length: 7 }, (_, i) =>
    `${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]}: 9:00 AM – 7:00 PM`);
  const d = pinDescription({ title: 'Museum', region: 'Pisa', country: 'Italy', place: { name: 'Museum', openingHours: hours } });
  assert.match(d, /^Open daily 9am-7pm\./);
});

test('장소 데이터가 없으면 글의 quickAnswer 첫 문장이 훅이 된다', () => {
  const d = pinDescription({
    title: '3Fils', region: 'Abu Dhabi', country: 'United Arab Emirates',
    quickAnswer: '3Fils Abu Dhabi is the sister outpost of Dubai\'s globally ranked 3Fils, tucked inside a hotel on Al Maryah Island. Book ahead.',
  });
  assert.match(d, /^3Fils Abu Dhabi is the sister outpost/);
});

test('금액이 든 문장은 훅으로 쓰지 않는다 (09-20 지어낸 가격 부류를 핀으로 흘리지 않기)', () => {
  const hook = openingHook({ quickAnswer: 'Entry costs 30 THB for adults and the palace opens at nine every morning of the week.' });
  assert.equal(hook, null);
});

test('지나간 이벤트 문장은 훅으로 쓰지 않는다 — 핀은 영구적이다', () => {
  assert.equal(openingHook({ quickAnswer: 'MEFCC 2026 was set for September 11-13, 2026, at ADNEC Centre Abu Dhabi, the 14th edition.' }), null);
  const now = new Date('2026-09-21');
  assert.equal(isPerishable('The 2025 edition drew 40,000 visitors to the riverside park.', now), true);
  // …but history is not perishable.
  assert.equal(isPerishable('The aquarium opened in 1998 on reclaimed land at the harbour mouth.', now), false);
  assert.equal(isPerishable('Rebuilt in 1867 as the main royal palace of the Joseon dynasty.', now), false);
});

test('핀은 글에 없는 섹션을 약속하지 않는다', () => {
  const post = { title: 'Somewhere', region: 'Aberdeen', country: 'Hong Kong', place: { name: 'Somewhere', openingHours: ['Monday: 9:00 AM – 5:00 PM'] } };
  const withDirections = pinDescription(post, ['## Getting there', 'Take the MTR to Aberdeen.', '', '## When to go', 'Mornings are quiet.'].join('\n'));
  assert.match(withDirections, /how to get there/);
  const without = pinDescription(post, ['A seafront promenade.', '', '## When to go', 'Mornings are quiet.'].join('\n'));
  assert.doesNotMatch(without, /how to get there/);
});

test('훅이 이미 영업시간을 말했으면 끝 문장에서 되풀이하지 않는다', () => {
  const hours = Array.from({ length: 7 }, (_, i) =>
    `${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]}: 9:00 AM – 7:00 PM`);
  const d = pinDescription({ title: 'Museum', region: 'Pisa', country: 'Italy', place: { name: 'Museum', openingHours: hours } }, ['## When to go', 'Early.', '', '## Getting there', 'Bus 21.'].join('\n'));
  assert.doesNotMatch(d, /Opening hours/);
  assert.match(d, /^Open daily/);
});

test('시계 표기와 균일 영업시간 판정', () => {
  assert.equal(tidyClock('9:00 AM – 7:00 PM'), '9am-7pm');
  assert.equal(tidyClock('10:30 AM – 6:00 PM'), '10:30am-6pm');
  // Seven real weekdays — not seven copies of Monday, which is what this test
  // used to pass in until Codex pointed out it is not a week (2026-09-21).
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  assert.equal(uniformHours(days.map((d) => `${d}: 9:00 AM – 5:00 PM`)), '9am-5pm');
  assert.equal(uniformHours(days.map((d) => `${d}: Closed`)), null);
  assert.equal(uniformHours(['Monday: 9:00 AM – 5:00 PM']), null);
});

// ── 2026-09-21, second pass: the six defects Codex found in the ladder ───────
// Every one of them let a pin state something that was not true, and a pin is
// permanent. Each is pinned down here in both directions.

const WEEK = (f) => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(f);

test('돈: 통화가 숫자 앞에 와도 막는다 ("USD 20" · "50 AED")', () => {
  for (const q of [
    'Entry costs USD 20 for adults visiting the palace and its walled gardens.',
    'Entry costs 20 USD for adults visiting the palace and its walled gardens.',
    'Entry costs 50 AED for adults visiting the palace and its walled gardens.',
    'Entry costs 300 baht for adults visiting the palace and its walled gardens.',
  ]) assert.equal(openingHook({ quickAnswer: q }), null, q);
  // 시간·거리 숫자는 막지 않는다
  assert.ok(openingHook({ quickAnswer: 'A 30 minute walk from the station brings you to the main gate of the old town.' }));
});

test('구글 메타 설명 폴백도 같은 검사를 받는다', () => {
  const d = pinDescription({
    title: 'Museum', region: 'Pisa', country: 'Italy',
    description: 'Admission costs $20 for adults.',
    place: { busyness: { weekdayQuiet: [9] } },
  }, 'The museum opened in 1867.');
  assert.doesNotMatch(d, /\$20/);
});

test('올해 안이라도 이미 지난 날짜면 훅으로 쓰지 않는다', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  assert.equal(isPerishable('The festival runs September 11-13, 2026, at the city exhibition centre.', now), true);
  assert.equal(isPerishable('The festival runs October 11-13, 2026, at the city exhibition centre.', now), false);
});

test('본문에 우연히 걸린 낱말은 섹션이 아니다', () => {
  assert.equal(offersLine('Learn how to get tickets online.'), null);
  assert.equal(offersLine('The quiet courtyard contains a bronze statue.'), null);
  assert.equal(offersLine(['## Getting there', 'Take the metro.', '', '## When to go', 'Mornings are quietest.'].join('\n')),
    'How to get there and when to go to beat the crowds.');
});

test('읽을 수 없는 요일 줄을 영업일로 단정하지 않는다 ("Sunday : Closed")', () => {
  const odd = ['Monday: Closed', 'Tuesday: Closed', 'Wednesday: Closed',
    'Thursday: 9:00 AM – 5:00 PM', 'Friday: 9:00 AM – 5:00 PM', 'Saturday: 9:00 AM – 5:00 PM',
    'Sunday : Closed'];
  const hook = openingHook({ place: { openingHours: odd } });
  assert.match(hook.text, /^Open Thursdays, Fridays and Saturdays only\.$/);
  assert.doesNotMatch(hook.text, /Sunday/, 'a closed Sunday must never be announced as open');
});

test('요일 7줄이라고 한 주가 아니다 — 같은 요일 반복은 거부', () => {
  assert.equal(parseDayLines(Array(7).fill('Monday: 9:00 AM – 5:00 PM')), null);
  assert.equal(openingHook({ place: { openingHours: Array(7).fill('Monday: 9:00 AM – 5:00 PM') } }), null);
  assert.equal(parseDayLines(WEEK((d) => `${d}: 9:00 AM – 5:00 PM`)).size, 7);
  assert.equal(openingHook({ place: { openingHours: WEEK((d) => `${d}: 9:00 AM – 5:00 PM`) } }).text, 'Open daily 9am-5pm.');
  assert.equal(parseDayLines(WEEK((d) => `${d}: 9:00 AM – 5:00 PM`).slice(0, 6)), null);
  assert.equal(parseDayLines(null), null);
});

test('이상한 프론트매터에도 죽지 않는다', () => {
  assert.doesNotThrow(() => pinDescription({}, ''));
  assert.doesNotThrow(() => pinDescription({ place: null }, null));
  assert.doesNotThrow(() => pinDescription({ place: { openingHours: 'Monday: 9-5' } }, ''));
  assert.doesNotThrow(() => pinDescription({ place: { busyness: { weekdayQuiet: 'nonsense' } } }, ''));
});

// ── 2026-09-21, third pass: what the second Codex review found ───────────────
// Three of these were regressions I introduced while fixing the first six —
// patching regexes one at a time is how that happens. The fixes below move the
// checks off keyword-guessing: section claims read the guide's HEADINGS, and an
// opening-hours value must be a clock or the word Closed, nothing else.

test('돈: 영어 낱말과 겹치는 통화코드로 멀쩡한 문장을 막지 않는다', () => {
  // "Try" is not Turkish lira; "May" is not money either.
  assert.ok(openingHook({ quickAnswer: 'Try 3 walking routes through the palace gardens before visiting the old museum.' }));
  assert.ok(openingHook({ quickAnswer: 'Visitors may bring 20 guests to the museum on any weekday afternoon here.' }));
});

test('돈: 기호가 뒤에 오거나 공백이 둘이어도 막는다', () => {
  assert.equal(openingHook({ quickAnswer: 'Admission costs 20 € for adults visiting the palace and its walled gardens.' }), null);
  assert.equal(openingHook({ quickAnswer: 'Admission costs USD  20 for adults visiting the palace and its walled gardens.' }), null);
});

test('날짜: 진행 중인 기간·미래 연도를 지났다고 하지 않는다', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  assert.equal(isPerishable('The festival runs September 11-October 13, 2026.', now), false);
  assert.equal(isPerishable('The festival runs September 11-13 2027.', now), false);
  assert.equal(isPerishable('The museum opened in May 1998 and retains its original courtyard.', now), false);
  assert.equal(isPerishable('May 20 people join each guided tour of the permanent collection?', now), false);
  // 소문자로 써도 지난 날짜는 지난 날짜다
  assert.equal(isPerishable('The festival runs september 11-13, 2026.', now), true);
});

test('영업시간 값은 시계이거나 Closed여야 한다 — 그 외엔 아무 말도 하지 않는다', () => {
  const odd = ['Monday: Closed', 'Tuesday: Closed', 'Wednesday: Closed', 'Thursday: Closed',
    'Friday: 9:00 AM – 5:00 PM', 'Saturday: 9:00 AM – 5:00 PM', 'Sunday: Closed (temporarily)'];
  const hook = openingHook({ place: { openingHours: odd } });
  assert.equal(hook, null, '일요일이 휴무인데 영업일로 광고하면 안 된다');
  const unknown = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    .map((d) => `${d}: Hours unavailable`);
  assert.equal(openingHook({ place: { openingHours: unknown } }), null);
});

test('섹션 약속은 본문 헤딩에서만 나온다 (낱말 추측 금지)', () => {
  assert.equal(offersLine('The collection includes paintings donated by taxi drivers.'), null);
  assert.equal(offersLine('This courtyard is less crowded than the main hall.'), null);
  assert.equal(offersLine('The best time to photograph the facade is sunset.'), null);
  assert.equal(offersLine('## Getting there\nTake the metro.\n\n## When to go\nMornings are quietest.'),
    'How to get there and when to go to beat the crowds.');
  assert.equal(offersLine('## Why go\nIt is beautiful.'), null);
});

test('폴백 문장 자르기가 살아 있다 (백슬래시 소실 회귀)', () => {
  const d = pinDescription({
    title: 'Garden', region: 'Kyoto', country: 'Japan',
    description: 'A peaceful garden beside the river. Entry costs USD 20.',
  }, '## Why go\nIt is lovely.');
  assert.match(d, /A peaceful garden beside the river\./);
  assert.doesNotMatch(d, /USD 20/);
});

test('이상한 인자에도 던지지 않는다', () => {
  assert.doesNotThrow(() => friendlyHours(42));
  assert.doesNotThrow(() => openingHook(null));
  assert.doesNotThrow(() => pinDescription(null, null));
  assert.doesNotThrow(() => offersLine('', null));
  assert.doesNotThrow(() => isPerishable('', null));
});

// ── 2026-09-21, fourth pass: Codex on the rewritten rules ────────────────────
// Two of these came out of the real corpus, not from invented inputs.

test('영업시간: 구글이 실제로 쓰는 15가지 표기를 전부 읽는다', () => {
  const week = (v) => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => `${d}: ${v}`);
  for (const v of ['9:00 AM - 5:00 PM', '9:00 AM – 5:00 PM', '12:00 - 14:00', '12:00 – 9:00 PM',
    '5:00 PM – 12:00 AM', '11:00 AM – 2:00 PM, 5:00 – 9:00 PM', 'Open 24 hours']) {
    assert.ok(parseDayLines(week(v)), `should parse: ${v}`);
  }
  // Cure Bali: Monday closed, split sessions the rest of the week.
  const cure = ['Monday: Closed', 'Tuesday: 5:00 PM – 12:00 AM', 'Wednesday: 5:00 PM – 12:00 AM',
    'Thursday: 5:00 PM – 12:00 AM', 'Friday: 5:00 PM – 12:00 AM', 'Saturday: 5:00 PM – 12:00 AM',
    'Sunday: 12:00 – 9:00 PM'];
  assert.equal(openingHook({ place: { openingHours: cure } }).text, 'Closed Mondays.');
  // …but an unreadable value still buys silence.
  assert.equal(parseDayLines(week('Hours unavailable')), null);
  assert.equal(parseDayLines(week('Closed (temporarily)')), null);
});

test('날짜: 월 약어와 문장 속 미래 연도', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  assert.equal(isPerishable('The festival runs Sept 11-13, 2026, at the city exhibition centre.', now), true);
  assert.equal(isPerishable('The festival runs Sep. 11-13, 2026, at the city exhibition centre.', now), true);
  assert.equal(isPerishable('The festival runs September 11-13 and October 11-13, 2027.', now), false);
});

test('주소 속 숫자를 가격으로 오인하지 않는다 (사자림 23 Yuan Lin Lu)', () => {
  const q = 'Lion Grove Garden (Shizi Lin), at 23 Yuan Lin Lu in Gusu District, is one of Suzhou\'s classical UNESCO-listed gardens, famous for a maze of grey limestone rockeries.';
  assert.ok(openingHook({ quickAnswer: q }), '주소는 가격이 아니다');
  // 진짜 금액은 여전히 막는다
  assert.equal(openingHook({ quickAnswer: 'Entry costs 300 baht for adults visiting the palace and its walled gardens.' }), null);
  assert.equal(openingHook({ quickAnswer: 'Entry costs ¥30 for adults visiting the palace and its walled gardens today.' }), null);
});

test('500자에서 해시태그가 반 토막 나지 않는다', () => {
  const d = pinDescription({ region: 'Kyoto', country: 'Japan', description: 'garden '.repeat(61) });
  assert.ok(d.length <= 500, `length ${d.length}`);
  // Whatever survives the cut must be a WHOLE tag: a half tag is a different
  // tag that nobody searches ("#ThingsToDoInKyot").
  for (const tag of d.match(/#\S+/g) || []) {
    assert.ok(['#Kyoto', '#Japan', '#ThingsToDoInKyoto'].includes(tag), `truncated hashtag: ${tag}`);
  }
});

test('본문 속 우물정자는 해시태그가 아니다 (싱가포르 유닛번호 #01-84)', () => {
  const d = pinDescription({
    region: 'Marina Bay', country: 'Singapore',
    quickAnswer: 'Le Noir sits at #01-84 in the Esplanade Mall, a riverside bar with live music every night of the week.',
  }, '## When to go\nEvenings.');
  assert.match(d, /01-84/);
  for (const tag of d.match(/#\S+/g) || []) {
    assert.ok(/^#[A-Z]/.test(tag), `junk hashtag: ${tag}`);
  }
});

test('날짜가 박힌 문장은 미래라도 훅이 아니다 — 핀은 영구적이다', () => {
  const q = 'GITEX Vietnam (officially GITEX AI Vietnam) runs October 1-2, 2026 in Hanoi, part of the global network.';
  assert.equal(openingHook({ quickAnswer: q }), null);
  assert.equal(hasSpecificDate('runs October 1-2, 2026 in Hanoi'), true);
  assert.equal(hasSpecificDate('The night market runs every Friday evening along the old canal.'), false);
});

test('answer 훅 위에 메타 설명을 겹쳐 쓰지 않는다', () => {
  const d = pinDescription({
    region: 'Hanoi', country: 'Vietnam',
    quickAnswer: 'Tran Quoc Pagoda is the oldest Buddhist temple in Hanoi, standing on a small islet in West Lake since the sixth century.',
    description: 'Tran Quoc Pagoda in Hanoi, Vietnam — the oldest Buddhist temple in the city.',
  }, '## When to go\nEarly morning.');
  assert.equal((d.match(/Tran Quoc Pagoda/g) || []).length, 1, '같은 사실이 두 번 나오면 안 된다');
});


// ── 한산한 시간은 "그 시간이 참인 날"로 말한다 (2026-09-21) ──────
// 묶음("주말")을 교차해 버리면 참인 사실까지 사라진다. 메트로폴리탄의 5시는
// 진짜로 한산하다 — 금·토에만 9시까지 열기 때문이다. 그래서 날별로 재고
// 뜻이 같은 날끼리 묶는다. 잃는 것 없이 더 정확해진다.
const week = (mon, sat = mon, sun = mon) => [
  `Monday: ${mon}`, `Tuesday: ${mon}`, `Wednesday: ${mon}`, `Thursday: ${mon}`,
  `Friday: ${mon}`, `Saturday: ${sat}`, `Sunday: ${sun}`,
];

test('🛑 토요일에 닫는 시간을 "주말"이라 하지 않고, 일요일로 정확히 말한다 — Subhash Bose Park', () => {
  const openingHours = week('6:00 – 9:00 AM, 2:00 – 8:30 PM', undefined, '6:00 – 9:00 AM, 11:00 AM – 8:30 PM');
  const hook = openingHook({ place: { busyness: { weekendQuiet: [11, 12, 13] }, openingHours } });
  assert.equal(hook.text, 'Quietest Sundays 11am-2pm.');
});

test('✅ 금·토 야간개장이 "평일 5시"라는 거짓 대신 진짜 사실로 나온다 — 메트로폴리탄', () => {
  const openingHours = [
    'Monday: 10:00 AM – 5:00 PM', 'Tuesday: 10:00 AM – 5:00 PM', 'Wednesday: Closed',
    'Thursday: 10:00 AM – 5:00 PM', 'Friday: 10:00 AM – 9:00 PM',
    'Saturday: 10:00 AM – 9:00 PM', 'Sunday: 10:00 AM – 5:00 PM'];
  const hook = openingHook({ place: { busyness: { weekdayQuiet: [17], weekendQuiet: [17] }, openingHours } });
  assert.equal(hook.text, 'Quietest Fridays and Saturdays 5-6pm.');
});

test('🛑 토요일 6시 폐관·일요일 10시30분 개관을 약속하지 않는다 — Sagrada Família', () => {
  const openingHours = week('9:00 AM – 8:00 PM', '9:00 AM – 6:00 PM', '10:30 AM – 8:00 PM');
  const hook = openingHook({ place: { busyness: { weekdayQuiet: [9, 18, 19], weekendQuiet: [9, 18, 19] }, openingHours } });
  assert.equal(hook.text, 'Quietest weekdays 9-10am and 6-8pm, Sundays 6-8pm.');
});

test('✅ 일주일이 똑같으면 요일 이름을 붙이지 않는다', () => {
  assert.equal(quietWindowSummaryWithinHours({ weekdayQuiet: [9], weekendQuiet: [9] }, week('9:00 AM – 8:00 PM')),
    '9:00-10:00');
});

test('✅ 영업시간이 없으면 검사할 것이 없다 — 기존 평일/주말 표기 유지', () => {
  assert.equal(quietWindowSummaryWithinHours({ weekdayQuiet: [7, 8] }, undefined), 'weekdays 7:00-9:00');
  assert.equal(quietWindowSummaryWithinHours({ weekdayQuiet: [7, 8] }, []), 'weekdays 7:00-9:00');
});

test('✅ 자정을 넘기는 영업시간이 멀쩡한 훅을 지우면 안 된다', () => {
  assert.equal(quietWindowSummaryWithinHours({ weekdayQuiet: [7, 8, 9], weekendQuiet: [7, 8, 9] }, week('7:00 AM – 12:00 AM')),
    '7:00-10:00');
  assert.equal(quietWindowSummaryWithinHours({ weekdayQuiet: [23], weekendQuiet: [23] }, week('11:00 AM – 3:00 AM')),
    '23:00-24:00');
});

test('🛑 한 시간이 안 되는 영업 구간을 "24시간 영업"으로 읽지 않는다', () => {
  // 4:30–5:30 PM 은 16:30~17:30 이다. 개장을 17로 올린 뒤 폐장 17과 비교해
  // "자정 넘김"으로 오판하면 하루 전체가 열린 것이 됐다(09-21 교차검증).
  const byDay = openHourSetsByDay(week('4:30 – 5:30 PM, 7:30 – 9:00 PM'));
  assert.deepEqual([...byDay.get('Monday')].sort((a, b) => a - b), [20]);
  const short = openHourSetsByDay(week('3:15 – 3:45 PM, 4:00 – 4:30 PM'));
  assert.equal(short.get('Monday').size, 0, '온전한 한 시간이 없으면 추천할 시간도 없다');
});

test('요일 묶음 이름 — 실측 분포대로', () => {
  const D = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  assert.equal(dayGroupLabel(D), null, '일주일 전체는 이름이 필요 없다');
  assert.equal(dayGroupLabel(D.slice(0, 5)), 'weekdays');
  assert.equal(dayGroupLabel(D.slice(5)), 'weekends');
  assert.equal(dayGroupLabel(['Friday', 'Saturday']), 'Fridays and Saturdays');
  assert.equal(dayGroupLabel(['Sunday']), 'Sundays');
  assert.equal(dayGroupLabel(D.filter((d) => d !== 'Wednesday')), 'every day but Wednesdays',
    '여섯 요일을 읊는 것보다 빠진 하루를 말하는 편이 낫다');
});

test('묶음이 셋 이상이면 큰 것 둘만 말한다 — 한 문장에 담기지 않는 주간표는 훅이 아니다', () => {
  const openingHours = [
    'Monday: 9:00 AM – 8:00 PM', 'Tuesday: 9:00 AM – 6:00 PM', 'Wednesday: 9:00 AM – 8:00 PM',
    'Thursday: 9:00 AM – 8:00 PM', 'Friday: 9:00 AM – 8:00 PM',
    'Saturday: 9:00 AM – 6:00 PM', 'Sunday: 11:00 AM – 8:00 PM'];
  const s = quietWindowSummaryWithinHours({ weekdayQuiet: [9, 18], weekendQuiet: [9, 18] }, openingHours);
  // 라벨이 콤마를 품으면 둘째 묶음은 붙이지 않는다 — 읽히지 않는 문장이 된다.
  assert.equal(s, 'Mondays, Wednesdays, Thursdays and Fridays 9:00-10:00 and 18:00-19:00');
});

test('quietDayGroups 계약 — 읽을 수 없으면 null, 남는 시간이 없으면 빈 배열', () => {
  assert.equal(quietDayGroups({ weekdayQuiet: [9] }, undefined), null, '영업시간이 없으면 판정하지 않는다');
  assert.equal(quietDayGroups(null, week('9:00 AM – 5:00 PM')), null);
  assert.deepEqual(quietDayGroups({ weekdayQuiet: [3], weekendQuiet: [3] }, week('9:00 AM – 5:00 PM')), [],
    '새벽 3시는 어느 날에도 열려 있지 않다');
});
