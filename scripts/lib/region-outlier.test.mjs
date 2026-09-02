// region-outlier 회귀 테스트 — 2026-09-02 구역 오배정 24편의 게이트 쪽 절반.
//
//   node --test scripts/lib/region-outlier.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { regionOutlier, findRegionOutliers, haversineKm, regionCentre } from './region-outlier.mjs';

// 침사추이 실제 좌표 — 프롬나드·워터프런트 공원·우주박물관 근처.
const TST = [
  { lat: 22.2935, lng: 114.1720 },
  { lat: 22.2948, lng: 114.1690 },
  { lat: 22.2960, lng: 114.1745 },
  { lat: 22.2985, lng: 114.1770 },
];
const SHEUNG_YIU = { lat: 22.3926, lng: 114.3214 }; // 사이궁 컨트리파크 — 침사추이에서 ~18 km
const K11 = { lat: 22.2955, lng: 114.1735 };        // 침사추이 한복판

test('haversine: 침사추이→사이궁 민속박물관은 18 km 안팎', () => {
  const d = haversineKm(K11.lat, K11.lng, SHEUNG_YIU.lat, SHEUNG_YIU.lng);
  assert.ok(d > 17 && d < 20, `got ${d}`);
});

test('멀리 떨어진 글은 붙든다 (far post is held)', () => {
  const hit = regionOutlier(SHEUNG_YIU, TST);
  assert.ok(hit, 'expected a finding');
  assert.ok(hit.distanceKm > 10, `distance ${hit.distanceKm}`);
  assert.equal(hit.peers, 4);
  assert.ok(hit.spreadKm < 1, `spread ${hit.spreadKm}`);
});

test('구역 안의 글은 통과한다 (near post passes)', () => {
  assert.equal(regionOutlier(K11, TST), null);
});

test('좌표 있는 이웃이 3편 미만이면 건너뛴다 (region with < 3 posts is skipped)', () => {
  assert.equal(regionOutlier(SHEUNG_YIU, TST.slice(0, 2)), null);
  // 좌표 없는 이웃은 세지 않는다 — 셋 중 하나가 좌표 없으면 2편 취급.
  assert.equal(regionOutlier(SHEUNG_YIU, [TST[0], TST[1], { lat: undefined }]), null);
  // 정확히 3편이면 검사한다.
  assert.ok(regionOutlier(SHEUNG_YIU, TST.slice(0, 3)));
});

test('두 문턱을 모두 요구한다: 넓게 퍼진 구역의 12 km 글은 통과', () => {
  // 사이궁 반도처럼 글들이 20 km 에 걸쳐 퍼진 구역: 중앙 퍼짐 ~9 km.
  const wide = [
    { lat: 22.30, lng: 114.25 }, { lat: 22.45, lng: 114.35 },
    { lat: 22.38, lng: 114.20 }, { lat: 22.42, lng: 114.40 },
  ];
  const c = regionCentre(wide);
  assert.ok(c.spreadKm > 5, `spread ${c.spreadKm}`);
  const twelveKmOut = { lat: c.lat + 0.108, lng: c.lng }; // ≈ 12 km north
  assert.equal(regionOutlier(twelveKmOut, wide), null); // > 10 km but < 4× spread
});

test('좌표 없는 새 글은 판정하지 않는다', () => {
  assert.equal(regionOutlier({ lat: undefined, lng: undefined }, TST), null);
  assert.equal(regionOutlier({ lat: 'x', lng: 1 }, TST), null);
});

test('전체 말뭉치: 드래프트는 이웃으로 세지 않되 검사는 받는다', () => {
  const mk = (file, extra) => ({ file, country: 'Hong Kong', region: 'Tsim Sha Tsui', draft: false, ...extra });
  const posts = [
    ...TST.map((p, i) => mk(`tst-${i}.md`, p)),
    mk('sai-kung-hong-kong-space-museum.md', SHEUNG_YIU),
    mk('held.md', { ...SHEUNG_YIU, draft: true }),
    mk('other-country.md', { ...SHEUNG_YIU, country: 'Singapore' }), // 혼자 → 건너뜀
  ];
  const hits = findRegionOutliers(posts).map((h) => h.post.file).sort();
  assert.deepEqual(hits, ['held.md', 'sai-kung-hong-kong-space-museum.md']);
  // 드래프트 2편이 이웃으로 셌다면 중앙점이 사이궁 쪽으로 끌려가 판정이 흐려진다.
  const hit = findRegionOutliers(posts).find((h) => h.post.file === 'sai-kung-hong-kong-space-museum.md');
  assert.equal(hit.peers, 4);
});
