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
import { photoIdentity, isIdentityRejection, identityRejection } from './photo-verdict.mjs';

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
