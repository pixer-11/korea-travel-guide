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

test('표는 승인 범위(유럽·미국·중동 + 호주 4개 도시)만 — 아시아 도시가 섞이면 실패', () => {
  const allowed = new Set(['France', 'Italy', 'Spain', 'United Kingdom', 'United States', 'United Arab Emirates', 'Turkey', 'Australia']);
  // Australia: only the four cities with enough Tiqets stock (10-04).
  assert.deepEqual(Object.entries(TIQETS_CITY).filter(([, m]) => m.country === 'Australia').map(([c]) => c).sort(), ['Cairns', 'Gold Coast', 'Melbourne', 'Sydney']);
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

test('명소 표: 키마다 글이 있고, 그 글의 도시가 Tiqets 도시 표에 있고, 상품은 티켓 페이지다 (10-04)', async () => {
  const { TIQETS_VENUE, TIQETS_CITY } = await import('./tiqets-link.mjs');
  const { readFileSync, existsSync } = await import('node:fs');
  const bad = [];
  for (const [id, slug] of Object.entries(TIQETS_VENUE)) {
    const f = new URL(`../content/posts/${id}.md`, import.meta.url);
    if (!existsSync(f)) { bad.push(`${id}: no such post`); continue; }
    const fm = readFileSync(f, 'utf8').split(/\r?\n---/)[0];
    const region = /^region:\s*"?([^"\r\n]+)"?/m.exec(fm)?.[1]?.trim();
    if (!TIQETS_CITY[region]) bad.push(`${id}: region ${region} is not a Tiqets city`);
    if (!/-tickets-l\d+$/.test(slug)) bad.push(`${id}: ${slug} is not a ticket page`);
  }
  assert.deepEqual(bad, []);
});

test('명소 링크는 그 명소 상품 페이지로, 모르는 글은 null', async () => {
  const { tiqetsVenueUrl } = await import('./tiqets-link.mjs');
  const u = tiqetsVenueUrl({ postId: 'rome-colosseum', lang: 'ko', subId: 'post_place' });
  assert.match(u, /^https:\/\/tp\.media\/r\?marker=754088&trs=553157&p=2074&campaign_id=89&sub_id=post_place&u=/);
  assert.equal(decodeURIComponent(u.split('&u=')[1]), 'https://www.tiqets.com/ko/colosseum-tickets-l145769/');
  assert.equal(tiqetsVenueUrl({ postId: 'no-such-post', lang: 'en' }), null);
  // Free places keep the city page: no product is sold "for" them.
  assert.equal(tiqetsVenueUrl({ postId: 'rome-trevi-fountain', lang: 'en' }), null);
  // Free entry too (Codex, 10-04): their Tiqets pages sell only paid extras.
  for (const id of ['london-the-british-museum', 'los-angeles-griffith-observatory', 'paris-notre-dame-cathedral-of-paris']) assert.equal(tiqetsVenueUrl({ postId: id, lang: 'en' }), null, id);
});
