import test from 'node:test';
import assert from 'node:assert/strict';
import { pinDescription, friendlyHours } from './pin-description.mjs';

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

test('장소·지역·평점·실용 정보가 순서대로 들어간다', () => {
  const d = pinDescription(POST);
  assert.match(d, /Fushimi Inari Taisha in Kyoto, Japan\./);
  assert.match(d, /4\.7★ from 62,208 visitors\./);
  assert.match(d, /Opening hours, how to get there/);
});

test('검색어 해시태그가 꼬리에 붙고 500자를 넘지 않는다', () => {
  const d = pinDescription(POST);
  assert.match(d, /#Kyoto #Japan #ThingsToDoInKyoto$/);
  assert.ok(d.length <= 500, `length ${d.length}`);
});

test('혼잡 데이터가 없으면 첫 문장으로 채우고, 평점이 얇으면 숫자를 쓰지 않는다', () => {
  const d = pinDescription({ ...POST, place: { name: 'Somewhere', rating: 4.9, userRatingsTotal: 12 } });
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
