// 차단기는 "막히는가" 와 "정상까지 막진 않는가" 둘 다 재야 한다.
//   node --test scripts/lib/event-hero-tier.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { heroTierReason, fileNamesTheEvent } from './event-hero-tier.mjs';

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

// 2026-09-14 코덱스 재현: 부분 문자열로 맞추던 첫 판이 남겨 둘 뻔한 남의 사진 셋.
test('부분 문자열로는 통과하지 않는다 — Hue/Ubud/Nha Trang 오탐', () => {
  const U = (f) => `https://upload.wikimedia.org/wikipedia/commons/1/11/${f}`;
  assert.equal(heroTierReason(U('Schuetzenfest_Berlin.jpg'), { region: 'Hue' }), null);
  assert.equal(heroTierReason(U('Batu_Buddha.jpg'), { region: 'Ubud' }), null);
  assert.equal(heroTierReason(U('Trang_Thailand.jpg'), { region: 'Nha Trang' }), null, '여러 단어 도시는 전부 있어야 한다');
});

// 실제로 3순위로 남긴 12장 가운데 모양이 다른 넷 — 엄격하게 바꿔도 그대로 남아야 한다.
test('실제 배치된 사진은 엄격한 규칙에서도 남는다', () => {
  const U = (f) => `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${f}/1920px-${f}`;
  assert.ok(heroTierReason(U('BITEC.JPG'), { region: 'Bangkok', eventVenue: 'Bangkok International Trade & Exhibition Centre (BITEC)' }), '괄호 약어');
  assert.ok(heroTierReason('https://upload.wikimedia.org/wikipedia/commons/5/5c/Qizhong_Stadium.jpg', { region: 'Shanghai', eventVenue: 'Qi Zhong Tennis Center' }), '붙여 쓴 이름');
  assert.ok(heroTierReason(U('Taipei_Arena_20170813.jpg'), { region: 'Taipei', eventVenue: 'Taipei Arena' }), '행사장 일반명사 제거');
  assert.ok(heroTierReason(U('Monumen_Nasional%2C_Jakarta%2C_Indonesia.jpg'), { region: 'Jakarta' }), '도시 이름 한 단어');
});

test('행사장이 일반명사뿐이면 근거가 되지 않는다', () => {
  assert.equal(heroTierReason('https://upload.wikimedia.org/wikipedia/commons/1/11/Some_Arena.jpg', { region: '', eventVenue: 'Arena' }), null);
});


// ── 파일명이 "행사 자체"를 가리키는가 (기록사진 규칙의 면제 조건) ──
const QUICK_STYLE = {
  title: 'Quick Style India Tour 2026: What to Know (Chandigarh)',
  region: 'Chandigarh',
  country: 'India',
};

test('도시 랜드마크 사진은 연도가 박혀 있어도 행사를 가리키지 않는다', () => {
  const url = 'https://upload.wikimedia.org/wikipedia/commons/1/1a/Palace_of_Assembly_Chandigarh_2006.jpg';
  assert.equal(fileNamesTheEvent(url, QUICK_STYLE), false);
  // 그리고 3순위(도시)로는 인정된다 — 두 조건이 같이 성립해야 면제된다.
  assert.ok(heroTierReason(url, QUICK_STYLE));
});

test('같은 도시 이름이 붙어 있어도 출연자 이름이 있으면 면제되지 않는다', () => {
  const url = 'https://upload.wikimedia.org/wikipedia/commons/1/1a/Quick_Style_Chandigarh_2006.jpg';
  assert.equal(fileNamesTheEvent(url, QUICK_STYLE), true);
});

test('도시·행사장·나라·연도는 "행사 이름"으로 치지 않는다', () => {
  const url = 'https://upload.wikimedia.org/wikipedia/commons/5/5c/Chandigarh_India_2026.jpg';
  assert.equal(fileNamesTheEvent(url, QUICK_STYLE), false);
});

test('빈 입력에 죽지 않는다', () => {
  assert.equal(fileNamesTheEvent('', QUICK_STYLE), false);
  assert.equal(fileNamesTheEvent('https://x/y.jpg', null), false);
});
