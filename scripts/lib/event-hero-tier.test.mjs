// 차단기는 "막히는가" 와 "정상까지 막진 않는가" 둘 다 재야 한다.
//   node --test scripts/lib/event-hero-tier.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { heroTierReason } from './event-hero-tier.mjs';

const COVERS = { Hanoi: { url: 'https://upload.wikimedia.org/wikipedia/commons/a/a1/Hoan_Kiem_at_dusk.jpg' } };

test('행사장 이름이 파일명에 있으면 남긴다 — 상하이 마스터스의 치종 스타디움', () => {
  const why = heroTierReason(
    'https://upload.wikimedia.org/wikipedia/commons/5/5c/Qizhong_Stadium.jpg',
    { region: 'Shanghai', eventVenue: 'Qi Zhong Tennis Center' },
  );
  assert.match(String(why), /행사장/);
});

test('도시 이름이 파일명에 있으면 남긴다 — 3순위', () => {
  const why = heroTierReason(
    'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Odaiba%2C_Tokyo_Japan.jpg/1920px-Odaiba%2C_Tokyo_Japan.jpg',
    { region: 'Tokyo' },
  );
  assert.match(String(why), /Tokyo/);
});

test('그 지역의 검증된 커버 사진이면 남긴다', () => {
  const why = heroTierReason(
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Hoan_Kiem_at_dusk.jpg/1600px-Hoan_Kiem_at_dusk.jpg',
    { region: 'Hanoi' },
    COVERS,
  );
  assert.match(String(why), /커버/);
});

test('아무 상관 없는 사진은 남길 근거가 없다', () => {
  assert.equal(heroTierReason(
    'https://upload.wikimedia.org/wikipedia/commons/1/11/Mexican_jazz_band.jpg',
    { region: 'Hanoi', eventVenue: 'Hanoi Opera House' },
  ), null);
});

test('region 도 행사장도 없으면 근거 없음 — 빈 문자열을 통과로 읽지 않는다', () => {
  assert.equal(heroTierReason('https://example.com/a.jpg', {}), null);
  assert.equal(heroTierReason('https://example.com/a.jpg', { region: '', eventVenue: '' }), null);
});

test('URL 이 없으면 근거 없음', () => {
  assert.equal(heroTierReason('', { region: 'Tokyo' }), null);
  assert.equal(heroTierReason(undefined, { region: 'Tokyo' }), null);
});

test('두 글자 이하 토큰으로는 통과하지 않는다 — 우연한 부분일치 방지', () => {
  // tokens() drops words of 1–2 characters, so a region like "Hue" must match
  // on the whole word and a file called "huge_crowd.jpg" must not slip through.
  assert.equal(heroTierReason('https://upload.wikimedia.org/wikipedia/commons/1/11/Random_photo.jpg', { region: 'Hue' }), null);
});
