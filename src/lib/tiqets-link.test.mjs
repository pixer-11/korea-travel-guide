// tiqets-link 회귀 테스트 (2026-10-01).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIQETS_CITY, tiqetsCityUrl, affiliateBrand } from './tiqets-link.mjs';

test('표에 있는 도시는 마커·Tiqets 프로그램·언어 경로가 붙은 딥링크', () => {
  const u = new URL(tiqetsCityUrl({ city: 'Paris', country: 'France', lang: 'ko', subId: 'Tours Paris!' }));
  assert.equal(u.hostname, 'tp.media');
  assert.equal(u.searchParams.get('marker'), '754088');
  assert.equal(u.searchParams.get('p'), '2074');
  assert.equal(u.searchParams.get('campaign_id'), '89');
  assert.equal(u.searchParams.get('sub_id'), 'tours_paris');
  assert.equal(u.searchParams.get('u'), 'https://www.tiqets.com/ko/things-to-do-in-paris-c66746/');
});

test('표에 없는 도시·다른 나라 이름이면 null (부르는 쪽이 Klook 으로 간다)', () => {
  assert.equal(tiqetsCityUrl({ city: 'Seoul', lang: 'en' }), null);
  assert.equal(tiqetsCityUrl({ city: 'Toledo', country: 'United States', lang: 'en' }), null);
  assert.equal(tiqetsCityUrl({ city: '', lang: 'en' }), null);
});

test('모르는 언어는 영어 경로', () => {
  assert.match(tiqetsCityUrl({ city: 'Rome', lang: 'xx' }), /tiqets\.com%2Fen%2F/);
});

test('표는 승인 범위(유럽·미국·중동)만 — 아시아·호주 도시가 섞이면 실패', () => {
  const allowed = new Set(['France', 'Italy', 'Spain', 'United Kingdom', 'United States', 'United Arab Emirates', 'Turkey']);
  for (const [city, m] of Object.entries(TIQETS_CITY)) {
    assert.ok(allowed.has(m.country), `${city} → ${m.country}`);
    assert.match(m.slug, new RegExp(`-c${m.id}$`), city);
  }
});

test('버튼 문구의 브랜드는 링크가 가는 곳을 따른다', () => {
  assert.equal(affiliateBrand(tiqetsCityUrl({ city: 'Paris', lang: 'en' }), 'ko'), 'Tiqets');
  assert.equal(affiliateBrand('/go/klook?to=x', 'ko'), '클룩');
  assert.equal(affiliateBrand('/go/klook?to=x', 'ja'), 'Klook');
});
