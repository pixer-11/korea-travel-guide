// "못 잰 것"과 "재서 틀린 것"을 가르는 판별기 테스트.
//
// 2026-08-30: data/visual-audit.json에 후보 사진 24건이 MISMATCH로 박혀 있었다.
// 사유를 읽어 보니 전부 "width: unknownpx" 또는 "image fetch 502" — 사진을
// 판정한 게 아니라 **가져오지 못한** 기록이었다. 읽는 쪽은 /MISMATCH/ 하나로
// 판정을 읽으니, 네트워크가 삐끗한 한순간이 사진의 영구 전과가 됐다.
// (24건 중 20건은 UA만 바꾸면 그 자리에서 열렸다. image-fetch.mjs 참조.)
//
// 이 판별기는 그 오염만 골라낸다. 반대로 **진짜 판정은 절대 지우면 안 된다** —
// 지우면 벌써 틀렸다고 밝혀진 사진이 다음 순찰에 조용히 되돌아온다.
//   node --test scripts/lib/audit-verdict.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { isMeasurementFailure } from './audit-verdict.mjs';

test('폭을 못 잰 기록은 측정 실패다', () => {
  assert.equal(isMeasurementFailure({ verdict: 'MISMATCH', reason: 'patrol reject: width: unknownpx < 1200' }), true);
});

test('일시적 거절(502·503·504·429)로 못 가져온 것도 측정 실패다', () => {
  for (const code of [502, 503, 504, 429]) {
    assert.equal(
      isMeasurementFailure({ verdict: 'MISMATCH', reason: `patrol reject: image unusable: image fetch ${code}` }),
      true,
      `HTTP ${code}`,
    );
  }
});

test('새로 쓰는 UNMEASURED 판정도 측정 실패다', () => {
  assert.equal(isMeasurementFailure({ verdict: 'UNMEASURED', reason: 'patrol retry: width: unknown (<1200) — could not measure' }), true);
});

// ── 반대 방향: 아래는 하나라도 지워지면 안 된다 ──

test('재서 기준 미달인 것은 진짜 판정이라 남긴다', () => {
  assert.equal(isMeasurementFailure({ verdict: 'MISMATCH', reason: 'patrol reject: width: 553px < 1200' }), false);
});

test('비전이 내용을 보고 내린 판정은 남긴다', () => {
  const real = [
    'patrol reject: Shows Santa Monica, USA street, not Abu Dhabi',
    'patrol reject: identity: credit names "El Nacional Barra de Vins", post is "Barra Oso"',
    'patrol reject: Studio-style packshot of raw seafood, not the venue itself',
    'event-mode back-audit: Ukrainian flags and clothing, unrelated to Uzbekistan event',
  ];
  for (const reason of real) {
    assert.equal(isMeasurementFailure({ verdict: 'MISMATCH', reason }), false, reason);
  }
});

test('404·410은 진짜 없는 것 — 측정 실패가 아니다', () => {
  assert.equal(isMeasurementFailure({ verdict: 'MISMATCH', reason: 'Foursquare CDN link dead (HTTP 404)' }), false);
  assert.equal(isMeasurementFailure({ verdict: 'MISMATCH', reason: 'image unusable: image fetch 410' }), false);
});

test('통과 판정(MATCH)은 건드리지 않는다', () => {
  assert.equal(isMeasurementFailure({ verdict: 'MATCH', reason: 'Lotus pond with trees' }), false);
});

test('사유가 없거나 값이 이상해도 터지지 않는다', () => {
  assert.equal(isMeasurementFailure({ verdict: 'MISMATCH' }), false);
  assert.equal(isMeasurementFailure(null), false);
  assert.equal(isMeasurementFailure(undefined), false);
  assert.equal(isMeasurementFailure('nonsense'), false);
});

// 숫자가 사유 안에 우연히 들어간 경우 — "502"가 판정 문장의 일부면 안 된다.
test('설명 문장에 우연히 502가 들어간 판정은 남긴다', () => {
  assert.equal(isMeasurementFailure({ verdict: 'MISMATCH', reason: 'patrol reject: sign reads "Route 502 Diner", wrong venue' }), false);
});
