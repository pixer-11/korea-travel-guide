import test from 'node:test';
import assert from 'node:assert/strict';
import { botSurge } from './bot-surge.mjs';

test('09-18·09-19 의 실제 수치는 봇으로 잡힌다', () => {
  assert.equal(botSurge({ visits: 7498, pageviews: 7508 }, { visitors: 41 }).suspect, true);
  assert.equal(botSurge({ visits: 6125, pageviews: 6154 }, { visitors: 34 }).suspect, true);
});

test('평소 날은 건드리지 않는다 (광고차단 때문에 원래 3배쯤 차이난다)', () => {
  // 09-07 ~ 09-16 실측: 비율 2.9~3.3, 사람 수는 18~39명으로 내내 같았다
  assert.equal(botSurge({ visits: 53, pageviews: 56 }, { visitors: 18 }).suspect, false);
  assert.equal(botSurge({ visits: 128, pageviews: 130 }, { visitors: 39 }).suspect, false);
  assert.equal(botSurge({ visits: 82, pageviews: 109 }, { visitors: 20 }).suspect, false);
});

test('물결의 꼬리도 잡는다 — 09-20 은 571 방문에 사람 31명, 방문당 1.02페이지', () => {
  // 7,498 → 6,125 → 571 로 꺼지는 중이지만 아직 사람 수의 18배이고 한 페이지만 본다.
  assert.equal(botSurge({ visits: 571, pageviews: 582 }, { visitors: 31 }).suspect, true);
});

test('격차가 커도 사람처럼 여러 페이지를 보면 경고하지 않는다', () => {
  assert.equal(botSurge({ visits: 4000, pageviews: 9000 }, { visitors: 40 }).suspect, false);
});

test('숫자가 작으면 판단하지 않는다', () => {
  assert.equal(botSurge({ visits: 290, pageviews: 291 }, { visitors: 2 }).suspect, false);
  assert.equal(botSurge({ visits: 0, pageviews: 0 }, { visitors: 0 }).suspect, false);
  assert.equal(botSurge({ visits: 5000, pageviews: 5000 }, null).suspect, false);
});

test('경고에는 판단 근거가 숫자로 들어간다', () => {
  const r = botSurge({ visits: 7498, pageviews: 7508 }, { visitors: 41 });
  assert.match(r.why, /1명당 방문 183회/);
  assert.match(r.why, /방문당 1\.00페이지/);
});
