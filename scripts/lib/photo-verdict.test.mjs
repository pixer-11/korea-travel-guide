// 신원 기각은 "그 URL"이 아니라 "그 사진"에 붙는다 — 그리고 되살아나면 안 된다.
//
// 2026-08-31 위키미디어가 thumb.wikimedia.org 로 답하기 시작하자, 저장소가
// 알던 키(upload… 3840px)와 후보 키(thumb… 3840px)가 달라졌다. 순찰의
// "전에 틀렸다고 판정한 사진인가?" 조회가 빗나갔고, 신원을 볼 수 없는 비전이
// MATCH를 찍어 08-14에 기각된 홍콩 죽집 주방 사진이 가데나 식당 글에 도로 붙었다.
//
// 반대 방향도 똑같이 위험하다: 비전이 한 번 "레스토랑이 아니다"라고 했다가
// 나중에 제대로 판정받아 복구된 사진(marseille-port-antique·naples-pompeii)까지
// 영구 차단하면, 멀쩡한 사진을 우리 손으로 내리는 것이다.
//   node --test scripts/lib/photo-verdict.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { photoIdentity, isIdentityRejection, identityRejection, isHandRejection , photoFamily } from './photo-verdict.mjs';

const SEP = String.fromCharCode(1);
const UPLOAD_3840 = 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/Kitchen_in_Nam_Long_Congee_Shop.jpg/3840px-Kitchen_in_Nam_Long_Congee_Shop.jpg';
const THUMB_3840 = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/66/Kitchen_in_Nam_Long_Congee_Shop.jpg/3840px-Kitchen_in_Nam_Long_Congee_Shop.jpg';
const UPLOAD_1920 = 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/Kitchen_in_Nam_Long_Congee_Shop.jpg/1920px-Kitchen_in_Nam_Long_Congee_Shop.jpg';
const ORIGINAL = 'https://upload.wikimedia.org/wikipedia/commons/6/66/Kitchen_in_Nam_Long_Congee_Shop.jpg';

const REJECTED = { slug: 'gardena-nam-kitchen', verdict: 'MISMATCH', reason: 'identity audit 2026-08-14: the photo metadata names a different venue/country' };
const store = {
  [`gardena-nam-kitchen${SEP}${UPLOAD_3840}`]: REJECTED,
  [`gardena-nam-kitchen${SEP}${UPLOAD_1920}`]: { verdict: 'MATCH', reason: 'Vietnamese kitchen, hanging ingredients' },
};

test('호스트·폭이 달라도 같은 Commons 파일이면 같은 신원이다', () => {
  const id = photoIdentity(UPLOAD_3840);
  assert.equal(id, 'commons:Kitchen_in_Nam_Long_Congee_Shop.jpg');
  for (const u of [THUMB_3840, UPLOAD_1920, ORIGINAL]) assert.equal(photoIdentity(u), id);
});

test('Commons가 아닌 URL은 신원이 없다(정확 키 조회만 유지)', () => {
  assert.equal(photoIdentity('https://fastly.4sqi.net/img/general/original/177941_Kbxq.jpg'), null);
  assert.equal(photoIdentity(''), null);
});

test('신원 기각은 다른 호스트로 와도 그대로 막힌다', () => {
  const hit = identityRejection(store, 'gardena-nam-kitchen', THUMB_3840, 'restaurant');
  assert.ok(hit, '호스트만 바뀐 같은 파일이 통과했다 — 08-31 사고 그대로다');
  assert.match(hit.reason, /identity audit/);
});

test('신원 기각은 다른 폭으로 와도 그대로 막힌다 (같은 글에 MATCH 행이 있어도)', () => {
  assert.ok(identityRejection(store, 'gardena-nam-kitchen', UPLOAD_1920, 'trendy'));
  assert.ok(identityRejection(store, 'gardena-nam-kitchen', ORIGINAL, 'attraction'));
});

test('비전이 내린 기각(캡션형)은 끈적이지 않는다 — 복구된 사진을 우리가 내리면 안 된다', () => {
  const visionOnly = { [`marseille-port-antique${SEP}${UPLOAD_3840}`]: { verdict: 'MISMATCH', reason: 'Ancient ruins park, not a restaurant venue' } };
  assert.equal(isIdentityRejection(visionOnly[`marseille-port-antique${SEP}${UPLOAD_3840}`]), false);
  assert.equal(identityRejection(visionOnly, 'marseille-port-antique', THUMB_3840, 'attraction'), null);
});

test('이벤트 글에는 적용하지 않는다 — 투어 아티스트 사진은 다른 도시에서 찍혀도 맞다', () => {
  const ev = { [`yokohama-babymonster${SEP}${UPLOAD_3840}`]: { verdict: 'MISMATCH', reason: 'patrol reject: identity: Commons places this in Seattle, post says Yokohama' } };
  assert.equal(identityRejection(ev, 'yokohama-babymonster', THUMB_3840, 'event'), null);
  assert.equal(identityRejection(ev, 'yokohama-babymonster', THUMB_3840, undefined), null);
});

test('다른 글의 기각은 이 글을 막지 않는다', () => {
  assert.equal(identityRejection(store, 'other-post', THUMB_3840, 'restaurant'), null);
});

test('MATCH만 있는 사진은 막지 않는다', () => {
  const clean = { [`x${SEP}${UPLOAD_1920}`]: { verdict: 'MATCH', reason: 'identity: Commons names Gardena' } };
  assert.equal(identityRejection(clean, 'x', UPLOAD_3840, 'restaurant'), null);
});

// ── 손으로 판정한 기각은 이벤트에도 붙는다 (2026-09-09) ───────────────
// 09-08 10:40 에 손으로 뗀 미초아칸 재즈 사진을 같은 날 22:15 보충 순찰이
// 도로 붙였다. 이벤트는 신원 스티키 대상이 아니어서, 순찰이 볼 수 있는
// 기각이 "비전이 방금 뒤집은 판정" 하나뿐이었기 때문이다.
const JAZZ = 'https://upload.wikimedia.org/wikipedia/commons/0/08/ADRIAN_OROPEZA_JAZZTIVAL_MICHOACAN_2015.jpg';
const JAZZ_1920 = 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/ADRIAN_OROPEZA_JAZZTIVAL_MICHOACAN_2015.jpg/1920px-ADRIAN_OROPEZA_JAZZTIVAL_MICHOACAN_2015.jpg';
const HAND = { slug: 'hanoi-hanoi-jazztival-2026', verdict: 'MISMATCH', reason: 'hand-reviewed 2026-09-09: a different festival (Jazztival in Michoacan, Mexico)' };

test('손 판정 기각은 이벤트 글에서도 막힌다', () => {
  const store = { [`hanoi-hanoi-jazztival-2026${SEP}${JAZZ}`]: HAND };
  assert.ok(isHandRejection(HAND));
  assert.ok(identityRejection(store, 'hanoi-hanoi-jazztival-2026', JAZZ, 'event'),
    '이벤트라서 통과했다 — 09-08 바운스가 그대로 재현된다');
});

test('손 판정 기각도 폭이 달라진 같은 파일을 막는다', () => {
  const store = { [`hanoi-hanoi-jazztival-2026${SEP}${JAZZ}`]: HAND };
  assert.ok(identityRejection(store, 'hanoi-hanoi-jazztival-2026', JAZZ_1920, 'event'));
});

test('🛑 비전이 찍은 MISMATCH는 이벤트에서 여전히 안 붙는다 (08-23 보호)', () => {
  // 순회 공연을 다른 도시에서 찍은 사진을 영구 차단하던 그 사고를 되살리면 안 된다.
  const vision = { slug: 'yokohama-babymonster', verdict: 'MISMATCH', reason: 'Concert stage, wrong venue for this show' };
  const store = { [`yokohama-babymonster${SEP}${JAZZ}`]: vision };
  assert.equal(identityRejection(store, 'yokohama-babymonster', JAZZ, 'event'), null,
    '이벤트에 자동 신원기각이 붙었다 — 08-23 회귀다');
  assert.equal(isHandRejection(vision), false);
});

test('🛑 장소 글의 자동 신원기각은 그대로 유지된다', () => {
  assert.ok(identityRejection(store, 'gardena-nam-kitchen', THUMB_3840, 'restaurant'));
  assert.equal(identityRejection(store, 'gardena-nam-kitchen', THUMB_3840, 'event'), null);
});


// 2026-09-11: 커먼즈는 한 촬영분을 형제 파일로 보관한다("…Concert.jpg", "…Concert-2.jpg").
// 사람이 -2 프레임을 "다른 행사"라고 거부해 뒀는데, 순찰이 접미사 없는 프레임을 같은
// 글에 하룻밤 만에 다시 올렸다(울트라 재팬, 09-09 거부 → 09-11까지 그대로 살아 있었다).
// 손으로 적은 거부는 프레임 하나가 아니라 촬영분 전체에 대한 판정이다.
test('손 거부는 같은 촬영분의 다른 프레임에도 적용된다', () => {
  const F = (n) => `https://upload.wikimedia.org/wikipedia/commons/1/17/${n}`;
  const store = { ['tokyo-ultra-japan-2026' + String.fromCharCode(1) + F('Drive_In_Ultra_Concert-2.jpg')]:
    { verdict: 'MISMATCH', reason: 'hand-reviewed 2026-09-09: a different event' } };
  assert.ok(identityRejection(store, 'tokyo-ultra-japan-2026', F('Drive_In_Ultra_Concert.jpg'), 'event'),
    '형제 프레임이 막히지 않으면 순찰이 같은 사진을 도로 올린다');
  assert.equal(identityRejection(store, 'tokyo-ultra-japan-2026', F('Odaiba_Tokyo_Japan.jpg'), 'event'), null,
    '무관한 사진까지 막으면 채울 방법이 없어진다');
});

// 반대 방향: 자동 판정은 자기가 본 프레임 하나에 대한 말이다. "크롭이 이상하다"가
// 같은 촬영분 전체를 영구 폐기하면 멀쩡한 사진이 무더기로 사라진다.
test('자동 신원 거부는 그 프레임에만 남는다', () => {
  const F = (n) => `https://upload.wikimedia.org/wikipedia/commons/1/17/${n}`;
  const store = { ['x' + String.fromCharCode(1) + F('Some_Venue-2.jpg')]:
    { verdict: 'MISMATCH', reason: 'identity audit: wrong venue' } };
  assert.equal(identityRejection(store, 'x', F('Some_Venue.jpg'), 'restaurant'), null);
  assert.ok(identityRejection(store, 'x', F('Some_Venue-2.jpg'), 'restaurant'));
});

test('photoFamily: 확장자와 프레임 번호만 떨어진다', () => {
  const F = (n) => `https://upload.wikimedia.org/wikipedia/commons/1/17/${n}`;
  assert.equal(photoFamily(F('A_B.jpg')), photoFamily(F('A_B-3.jpg')));
  assert.equal(photoFamily(F('A_B.jpg')), photoFamily(F('A_B (2).jpg')));
  assert.notEqual(photoFamily(F('A_B.jpg')), photoFamily(F('A_C.jpg')));
  assert.equal(photoFamily('https://example.com/not-commons.jpg'), null);
});
