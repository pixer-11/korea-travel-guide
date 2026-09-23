// 호텔 링크 회귀 테스트.
//
// 2026-09-23: 호텔 버튼이 닫힌 Hotellook 으로 가서 날짜는 버려지고 홍콩 애버딘이
// 영국으로 갔다. 지금은 수익이 추적되는 /go/klook 릴레이로 간다.
//
//   node --test src/lib/hotel-link.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hotelUrl } from './hotel-link.mjs';

const target = (href) => {
  const u = new URL(href, 'https://wanderatlasguides.com');
  return { u, to: new URL(u.searchParams.get('to')) };
};

test('우리 릴레이(/go/klook)를 지나간다 — 수익 추적이 거기서 붙는다', () => {
  const { u, to } = target(hotelUrl({ submarker: 'post_top', locale: 'en-US', place: 'Bangkok', country: 'Thailand' }));
  assert.equal(u.pathname, '/go/klook');
  assert.equal(u.searchParams.get('sub_id'), 'hotel_post_top');
  assert.equal(to.hostname, 'www.klook.com');
  assert.equal(to.pathname, '/en-US/search/');
  assert.equal(to.searchParams.get('query'), 'Bangkok Thailand hotels');
});

test('나라가 붙어 동명 도시가 갈린다 (홍콩 애버딘 ≠ 영국 애버딘)', () => {
  const { to } = target(hotelUrl({ submarker: 'hotels_widget', locale: 'ko', place: 'Aberdeen', country: 'Hong Kong' }));
  assert.equal(to.searchParams.get('query'), 'Aberdeen Hong Kong hotels');
  assert.equal(to.pathname, '/ko/search/');
});

test('나라 허브: place 와 country 가 같아도 두 번 쓰지 않는다', () => {
  const { to } = target(hotelUrl({ submarker: 'dest_hub', locale: 'ja', place: 'Japan', country: 'japan' }));
  assert.equal(to.searchParams.get('query'), 'Japan hotels');
});

test('나라가 없어도 동작한다', () => {
  const { to } = target(hotelUrl({ submarker: 'sticky_bar', locale: 'es', place: 'São Paulo' }));
  assert.equal(to.searchParams.get('query'), 'São Paulo hotels');
});

test('SubID 는 워커가 받는 글자만 쓴다', () => {
  const { u } = target(hotelUrl({ submarker: 'Events Hub!', locale: 'en-US', place: 'Seoul' }));
  assert.match(u.searchParams.get('sub_id'), /^[a-z0-9_]+$/);
});

test('더 이상 닫힌 Hotellook 으로 가지 않는다', () => {
  const href = hotelUrl({ submarker: 'post_top', locale: 'en-US', place: 'Tokyo', country: 'Japan' });
  assert.equal(/hotellook/.test(decodeURIComponent(href)), false);
});
