// hotellook 링크 헬퍼 회귀 테스트.
//
// 2026-08-28 감사(D·E): 호텔 링크가 날짜 없이 빈 검색폼에 착지했고, 같은
// URL 조립이 3개 컴포넌트에 복붙돼 있었다. 헬퍼 하나로 모으고 날짜를
// 프리필한다 — 이벤트 글은 행사 날짜로, 나머지는 +30일 2박으로.
//
//   node --test src/lib/hotellook.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hotellookUrl } from './hotellook.mjs';

const NOW = Date.parse('2026-08-28T12:00:00Z');

test('기본: 30일 뒤 체크인, 2박', () => {
  const u = new URL(hotellookUrl({ submarker: 'post_top', lang: 'ja', destination: 'Tokyo', now: NOW }));
  assert.equal(u.searchParams.get('marker'), '754088.post_top');
  assert.equal(u.searchParams.get('language'), 'ja');
  assert.equal(u.searchParams.get('destination'), 'Tokyo');
  assert.equal(u.searchParams.get('checkIn'), '2026-09-27');
  assert.equal(u.searchParams.get('checkOut'), '2026-09-29');
});

test('미래 이벤트 글: 행사 날짜가 체크인이 된다', () => {
  const u = new URL(hotellookUrl({ submarker: 'post_top', lang: 'en', destination: 'Saitama', eventStart: '2026-10-10', now: NOW }));
  assert.equal(u.searchParams.get('checkIn'), '2026-10-10');
  assert.equal(u.searchParams.get('checkOut'), '2026-10-12');
});

test('이미 지난 이벤트 날짜는 무시하고 기본으로 돌아간다', () => {
  const u = new URL(hotellookUrl({ submarker: 'sticky_bar', lang: 'en', destination: 'Busan', eventStart: '2026-01-01', now: NOW }));
  assert.equal(u.searchParams.get('checkIn'), '2026-09-27');
});

test('목적지는 URL 인코딩된다', () => {
  const raw = hotellookUrl({ submarker: 'hotels_widget', lang: 'ko', destination: 'São Paulo', now: NOW });
  assert.ok(raw.includes('S%C3%A3o'));
});
