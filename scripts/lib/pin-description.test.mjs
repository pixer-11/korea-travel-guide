import test from 'node:test';
import assert from 'node:assert/strict';
import { pinDescription, friendlyHours, openingHook, isPerishable, tidyClock, uniformHours } from './pin-description.mjs';

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
const BODY = 'Getting there: Inari Station is two minutes away. When to go: before 8am the gates are empty.';

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
  const withDirections = pinDescription(post, 'Getting there: take the MTR to Aberdeen. When to go: mornings are quiet.');
  assert.match(withDirections, /how to get there/);
  const without = pinDescription(post, 'A seafront promenade. When to go: mornings are quiet.');
  assert.doesNotMatch(without, /how to get there/);
});

test('훅이 이미 영업시간을 말했으면 끝 문장에서 되풀이하지 않는다', () => {
  const hours = Array.from({ length: 7 }, (_, i) =>
    `${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]}: 9:00 AM – 7:00 PM`);
  const d = pinDescription({ title: 'Museum', region: 'Pisa', country: 'Italy', place: { name: 'Museum', openingHours: hours } }, 'When to go: early. Getting there: bus 21.');
  assert.doesNotMatch(d, /Opening hours/);
  assert.match(d, /^Open daily/);
});

test('시계 표기와 균일 영업시간 판정', () => {
  assert.equal(tidyClock('9:00 AM – 7:00 PM'), '9am-7pm');
  assert.equal(tidyClock('10:30 AM – 6:00 PM'), '10:30am-6pm');
  assert.equal(uniformHours(Array(7).fill('Monday: 9:00 AM – 5:00 PM')), '9am-5pm');
  assert.equal(uniformHours(Array(7).fill('Monday: Closed')), null);
  assert.equal(uniformHours(['Monday: 9:00 AM – 5:00 PM']), null);
});
