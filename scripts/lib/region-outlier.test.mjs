// region-outlier 회귀 테스트 — 2026-09-02 구역 오배정 24편의 게이트 쪽 절반.
//
//   node --test scripts/lib/region-outlier.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  regionOutlier, findRegionOutliers, haversineKm, regionCentre,
  addressNamesOtherRegion, catchAllRegions, mentions,
} from './region-outlier.mjs';

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

test('(a) 멀리 떨어진 글은 거리 기준에 걸린다 (far post)', () => {
  const hit = regionOutlier(SHEUNG_YIU, TST);
  assert.ok(hit, 'expected a finding');
  assert.ok(hit.distanceKm > 10, `distance ${hit.distanceKm}`);
  assert.equal(hit.peers, 4);
  assert.ok(hit.spreadKm < 1, `spread ${hit.spreadKm}`);
});

test('(a) 구역 안의 글은 통과한다 (near post passes)', () => {
  assert.equal(regionOutlier(K11, TST), null);
});

test('(a) 좌표 있는 이웃이 3편 미만이면 건너뛴다 (region with < 3 posts is skipped)', () => {
  assert.equal(regionOutlier(SHEUNG_YIU, TST.slice(0, 2)), null);
  // 좌표 없는 이웃은 세지 않는다 — 셋 중 하나가 좌표 없으면 2편 취급.
  assert.equal(regionOutlier(SHEUNG_YIU, [TST[0], TST[1], { lat: undefined }]), null);
  // 정확히 3편이면 검사한다.
  assert.ok(regionOutlier(SHEUNG_YIU, TST.slice(0, 3)));
});

test('(a) 두 문턱을 모두 요구한다: 넓게 퍼진 구역의 12 km 글은 통과', () => {
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

test('(b) 주소의 구역명은 단어 단위·대소문자 무시로 읽는다', () => {
  assert.ok(mentions('10 Salisbury Rd, Tsim Sha Tsui, Kowloon, Hong Kong', 'tsim sha tsui'));
  assert.ok(!mentions('18 Marina Gardens Dr, Singapore', 'Marina Bay'));
  assert.ok(!mentions('Chiayi County, Taiwan', 'Chia')); // 단어 일부는 아니다
  // 거리 이름은 장소가 아니다 — 워싱턴의 국립수목원은 New York Ave 에 있다.
  assert.ok(!mentions('3501 New York Ave NE, Washington, DC 20002', 'New York'));
  assert.ok(mentions('Sai Kung Town, New Territories', 'Sai Kung'));
});

test('(b) 주소가 다른 라이브 구역을 이름 부르면 증거; 자기 구역·포괄 라벨은 아니다', () => {
  const live = new Set(['Sai Kung', 'Tsim Sha Tsui', 'Hong Kong', 'Lantau Island']);
  const catchAll = new Set(['Hong Kong']);
  assert.equal(addressNamesOtherRegion('10 Salisbury Rd, Tsim Sha Tsui, Kowloon, Hong Kong', 'Sai Kung', live, catchAll), 'Tsim Sha Tsui');
  // 자기 구역이 주소에 있으면 확인이지 증거가 아니다.
  assert.equal(addressNamesOtherRegion('Sai Kung, New Territories, Hong Kong', 'Sai Kung', live, catchAll), null);
  // 포괄 라벨만 있는 주소는 증거가 못 된다 — 모든 홍콩 주소가 "Hong Kong" 을 담는다.
  assert.equal(addressNamesOtherRegion('Cha Liu Au, Hong Kong', 'Jordan', live, catchAll), null);
  // 긴 이름 먼저: "Palm Jumeirah" 글의 주소는 "Jumeirah" 로 오독되지 않는다.
  const uae = new Set(['Jumeirah', 'Palm Jumeirah', 'Dubai']);
  assert.equal(addressNamesOtherRegion('Crescent Rd - Palm Jumeirah - Dubai', 'Palm Jumeirah', uae, new Set(['Dubai'])), null);
});

test('포괄 라벨: 나라 이름 + 다른 구역 글들의 주소에 두루 들어가는 이름', () => {
  const posts = [
    { country: 'United Arab Emirates', region: 'Deira', address: 'Al Ras - Deira - Dubai - UAE' },
    { country: 'United Arab Emirates', region: 'Jumeirah', address: 'Jumeirah Rd - Dubai - UAE' },
    { country: 'United Arab Emirates', region: 'Dubai', address: 'Downtown - Dubai - UAE' },
    { country: 'United Arab Emirates', region: 'Sharjah', address: 'Al Majaz - Sharjah - UAE' },
  ];
  const ca = catchAllRegions(posts);
  const names = ca.get('United Arab Emirates');
  assert.ok(names.has('Dubai'), 'Dubai 는 Deira·Jumeirah 주소에 들어간다');
  assert.ok(names.has('United Arab Emirates'));
  assert.ok(!names.has('Sharjah'));
  assert.ok(!names.has('Deira'));
});

const HK = (file, extra) => ({ file, country: 'Hong Kong', region: 'Tsim Sha Tsui', draft: false, inScope: false, address: '', ...extra });

test('전체 말뭉치: 거리 AND 주소 증거가 함께 있어야 잡는다', () => {
  const posts = [
    ...TST.map((p, i) => HK(`tst-${i}.md`, { ...p, address: `${i} Salisbury Rd, Tsim Sha Tsui, Kowloon, Hong Kong` })),
    // 사이궁 구역이 라이브로 존재해야 주소 증거가 성립한다.
    HK('sk-1.md', { region: 'Sai Kung', lat: 22.38, lng: 114.27, address: 'Sai Kung, New Territories, Hong Kong' }),
    // 실제 사례(수리 전): region 은 Sai Kung 인데 주소는 침사추이 → 잡힌다.
    HK('sai-kung-hong-kong-space-museum.md', { region: 'Sai Kung', ...K11, address: '10 Salisbury Rd, Tsim Sha Tsui, Kowloon, Hong Kong' }),
    HK('sk-2.md', { region: 'Sai Kung', lat: 22.39, lng: 114.28, address: 'Pak Tam Chung, Sai Kung, Hong Kong' }),
    HK('sk-3.md', { region: 'Sai Kung', lat: 22.37, lng: 114.26, address: 'Sai Kung Town, Hong Kong' }),
    // 거리는 멀지만 주소가 다른 구역을 이름 부르지 않는다 → 증거 없음 → 통과.
    HK('far-but-anonymous.md', { ...SHEUNG_YIU, address: 'Somewhere, Hong Kong' }),
    // 주소는 다른 구역이지만 거리상 제 구역 안 → 통과(거리 기준이 먼저).
    HK('near-but-named.md', { ...K11, address: 'Sai Kung Rd, Hong Kong' }),
  ];
  const hits = findRegionOutliers(posts);
  assert.deepEqual(hits.map((h) => h.post.file), ['sai-kung-hong-kong-space-museum.md']);
  assert.deepEqual(hits[0].evidence, { kind: 'address', region: 'Tsim Sha Tsui' });
});

test('전체 말뭉치: 다른 구역 무리 한가운데 앉은 글은 주소가 말이 없어도 잡는다', () => {
  const MB = [{ lat: 1.2816, lng: 103.8636 }, { lat: 1.2850, lng: 103.8607 }, { lat: 1.2833, lng: 103.8590 }];
  const SG = (file, extra) => ({ file, country: 'Singapore', draft: false, inScope: false, address: '', ...extra });
  const posts = [
    ...MB.map((p, i) => SG(`mb-${i}.md`, { region: 'Marina Bay', ...p })),
    SG('cq-1.md', { region: 'Clarke Quay', lat: 1.2906, lng: 103.8465 }),
    SG('cq-2.md', { region: 'Clarke Quay', lat: 1.2910, lng: 103.8470 }),
    SG('cq-3.md', { region: 'Clarke Quay', lat: 1.2900, lng: 103.8460 }),
    // ArtScience Museum: region Clarke Quay, 좌표는 Marina Bay 글들 옆. 자기
    // 구역 중앙에서 1.5 km — 10 km 문턱엔 못 미치므로 이 fixture 는 20 km 밖에
    // 둔 다른 구역 무리로 대신 확인한다.
  ];
  const farCluster = [{ lat: 1.45, lng: 103.90 }, { lat: 1.452, lng: 103.902 }, { lat: 1.448, lng: 103.898 }];
  farCluster.forEach((p, i) => posts.push(SG(`wl-${i}.md`, { region: 'Woodlands', ...p })));
  posts.push(SG('stray.md', { region: 'Clarke Quay', lat: 1.4505, lng: 103.9005, address: '1 Some Ave, Singapore' }));
  const hits = findRegionOutliers(posts);
  assert.deepEqual(hits.map((h) => h.post.file), ['stray.md']);
  assert.equal(hits[0].evidence.kind, 'cluster');
  assert.equal(hits[0].evidence.region, 'Woodlands');
});

test('전체 말뭉치: 자기 region 이 포괄 라벨이면 판정하지 않는다 (디즈니랜드/Hong Kong)', () => {
  const posts = [
    ...TST.map((p, i) => HK(`tst-${i}.md`, { ...p, address: `Tsim Sha Tsui, Kowloon, Hong Kong` })),
    HK('sk-1.md', { region: 'Sai Kung', lat: 22.38, lng: 114.27, address: 'Sai Kung, Hong Kong' }),
    HK('hk-1.md', { region: 'Hong Kong', lat: 22.28, lng: 114.16, address: 'Central, Hong Kong' }),
    HK('hk-2.md', { region: 'Hong Kong', lat: 22.29, lng: 114.17, address: 'Wan Chai, Hong Kong' }),
    HK('hk-3.md', { region: 'Hong Kong', lat: 22.28, lng: 114.15, address: 'Sheung Wan, Hong Kong' }),
    HK('hong-kong-hong-kong-disneyland.md', { region: 'Hong Kong', lat: 22.3130, lng: 114.0413, address: 'Lantau Island, Hong Kong' }),
    HK('li-1.md', { region: 'Lantau Island', lat: 22.25, lng: 113.90, address: 'Tai O, Lantau Island, Hong Kong' }),
  ];
  assert.deepEqual(findRegionOutliers(posts), []);
});

test('전체 말뭉치: 드래프트는 이웃으로 세지 않되 검사는 받는다', () => {
  const posts = [
    ...TST.map((p, i) => HK(`tst-${i}.md`, { ...p, address: 'Tsim Sha Tsui, Hong Kong' })),
    HK('sk-1.md', { region: 'Sai Kung', lat: 22.38, lng: 114.27, address: 'Sai Kung, Hong Kong' }),
    HK('live-wrong.md', { ...SHEUNG_YIU, address: 'Sai Kung, New Territories, Hong Kong' }),
    HK('held.md', { ...SHEUNG_YIU, address: 'Sai Kung, New Territories, Hong Kong', draft: true }),
  ];
  const hits = findRegionOutliers(posts);
  assert.deepEqual(hits.map((h) => h.post.file).sort(), ['held.md', 'live-wrong.md']);
  // 드래프트가 이웃으로 셌다면 중앙점이 사이궁 쪽으로 끌려가 판정이 흐려진다.
  assert.equal(hits.find((h) => h.post.file === 'live-wrong.md').peers, 4);
});

test('배치 뒤집힘 방지: 이번 발행분 n편은 피어가 아니다 — n=1..5 전부 붙든다', () => {
  // 커밋된 글 3편은 (0, 0) 근처, 새 글 n편은 위도 0.2 (≈ 22 km) 근처에 모여 있고
  // 주소는 다른 라이브 구역 "Farside" 를 이름 부른다.
  const base = (file, extra) => ({ file, country: 'Flatland', draft: false, inScope: false, address: 'Near, Flatland', ...extra });
  const committed = [
    base('c-0.md', { region: 'Near', lat: 0, lng: 0 }),
    base('c-1.md', { region: 'Near', lat: 0.01, lng: 0 }),
    base('c-2.md', { region: 'Near', lat: -0.01, lng: 0 }),
    base('f-0.md', { region: 'Farside', lat: 0.2, lng: 0.05, address: 'Farside, Flatland' }),
  ];
  for (let n = 1; n <= 5; n++) {
    const fresh = Array.from({ length: n }, (_, i) => base(`new-${i}.md`, {
      region: 'Near', lat: 0.2 + i * 0.001, lng: i * 0.001, address: `${i} Main St, Farside, Flatland`, inScope: true,
    }));
    const hits = findRegionOutliers([...committed, ...fresh]).map((h) => h.post.file).sort();
    assert.deepEqual(hits, fresh.map((p) => p.file).sort(), `n=${n}: expected every new post held, got ${hits}`);
  }
  // 역방향: 새 글을 피어로 세면(inScope 없이) n=4 부터 중앙점이 새 무리로
  // 넘어가 전부 통과한다 — 코덱스가 지적한 뒤집힘 그대로.
  const fresh4 = Array.from({ length: 4 }, (_, i) => base(`new-${i}.md`, {
    region: 'Near', lat: 0.2 + i * 0.001, lng: i * 0.001, address: `${i} Main St, Farside, Flatland`,
  }));
  assert.equal(findRegionOutliers([...committed, ...fresh4]).length, 0);
});
