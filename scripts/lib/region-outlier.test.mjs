// region-outlier 회귀 테스트 — 2026-09-02 구역 오배정 24편의 게이트 쪽 절반.
//
//   node --test scripts/lib/region-outlier.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  regionOutlier, findRegionOutliers, haversineKm, regionCentre,
  addressNamesOtherRegion, catchAllRegions, regionParents, mentions,
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
  assert.equal(regionOutlier(twelveKmOut, wide), null); // > minKm but < 4× spread
});

test('좌표 없는 글은 거리로는 판정하지 않는다', () => {
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

test('(b) 주소가 다른 라이브 구역을 이름 부르면 증거; 자기 구역·제외 목록은 아니다', () => {
  const live = new Set(['Sai Kung', 'Tsim Sha Tsui', 'Hong Kong', 'Lantau Island']);
  const exclude = new Set(['Hong Kong']);
  assert.equal(addressNamesOtherRegion('10 Salisbury Rd, Tsim Sha Tsui, Kowloon, Hong Kong', 'Sai Kung', live, exclude), 'Tsim Sha Tsui');
  // 자기 구역이 주소에 있으면 확인이지 증거가 아니다.
  assert.equal(addressNamesOtherRegion('Sai Kung, New Territories, Hong Kong', 'Sai Kung', live, exclude), null);
  // 포괄 라벨만 있는 주소는 증거가 못 된다 — 모든 홍콩 주소가 "Hong Kong" 을 담는다.
  assert.equal(addressNamesOtherRegion('Cha Liu Au, Hong Kong', 'Jordan', live, exclude), null);
  // 긴 이름 먼저: "Palm Jumeirah" 글의 주소는 "Jumeirah" 로 오독되지 않는다.
  const uae = new Set(['Jumeirah', 'Palm Jumeirah', 'Dubai']);
  assert.equal(addressNamesOtherRegion('Crescent Rd - Palm Jumeirah - Dubai', 'Palm Jumeirah', uae, new Set(['Dubai'])), null);
});

const UAE = [
  { country: 'United Arab Emirates', region: 'Deira', address: 'Al Ras - Deira - Dubai - UAE' },
  { country: 'United Arab Emirates', region: 'Jumeirah', address: 'Jumeirah Rd - Dubai - UAE' },
  { country: 'United Arab Emirates', region: 'Dubai', address: 'Downtown - Dubai - UAE' },
  { country: 'United Arab Emirates', region: 'Sharjah', address: 'Al Majaz - Sharjah - UAE' },
];

test('상위 구역: 어떤 구역 글들의 주소 과반이 부르는 이름은 그 구역의 부모다', () => {
  const tw = [
    { country: 'Taiwan', region: 'Sun Moon Lake', address: 'Yuchi Township, Nantou County, Taiwan' },
    { country: 'Taiwan', region: 'Sun Moon Lake', address: 'Sun Moon Lake, Nantou County, Taiwan' },
    { country: 'Taiwan', region: 'Sun Moon Lake', address: 'Zhongshan Rd, Yuchi Township, Taiwan' },
    { country: 'Taiwan', region: 'Nantou', address: 'Nantou City, Taiwan' },
    // 셋 중 하나만 부르는 건 부모가 아니다 — 잘못 태그된 글 하나가 만드는 흔적이 딱 그렇다.
    { country: 'Taiwan', region: 'Alishan', address: 'Alishan Township, Chiayi County' },
    { country: 'Taiwan', region: 'Alishan', address: 'Alishan Forest Recreation Area' },
    { country: 'Taiwan', region: 'Alishan', address: 'Fenqihu, Alishan' },
    { country: 'Taiwan', region: 'Chiayi', address: 'Chiayi City' },
  ];
  const p = regionParents(tw).get('Taiwan');
  assert.deepEqual([...p.get('Sun Moon Lake')], ['Nantou']);
  assert.deepEqual([...p.get('Alishan')], []);
});

test('포괄 라벨: 나라 이름 + 두 구역 이상의 부모', () => {
  const names = catchAllRegions(UAE).get('United Arab Emirates');
  assert.ok(names.has('Dubai'), 'Dubai 는 Deira·Jumeirah 의 부모');
  assert.ok(names.has('United Arab Emirates'));
  assert.ok(!names.has('Sharjah'));
  assert.ok(!names.has('Deira'));
});

const HK = (file, extra) => ({ file, country: 'Hong Kong', region: 'Tsim Sha Tsui', draft: false, inScope: false, address: '', ...extra });

test('전체 말뭉치: 주소 하나만으로 잡는다 — 피어·거리 불문 (원래 부류 그대로)', () => {
  const posts = [
    // 사이궁 구역이 라이브로 존재해야 주소 증거가 성립한다. 피어는 1편뿐.
    HK('sk-1.md', { region: 'Sai Kung', lat: 22.38, lng: 114.27, address: 'Sai Kung, New Territories, Hong Kong' }),
    HK('li-1.md', { region: 'Lantau Island', lat: 22.25, lng: 113.90, address: 'Tai O, Lantau Island, Hong Kong' }),
    // 실제 사례(수리 전): region 은 Lantau Island, 주소는 사이궁 → 잡힌다.
    HK('lantau-island-sheung-yiu-folk-museum.md', { region: 'Lantau Island', ...SHEUNG_YIU, address: 'Sai Kung, New Territories, Hong Kong' }),
    // 주소가 자기 구역도 함께 부르면 확인이다 → 통과.
    HK('li-2.md', { region: 'Lantau Island', lat: 22.26, lng: 113.91, address: 'Ngong Ping, Lantau Island (via Sai Kung ferry), Hong Kong' }),
    // 주소가 아무 구역도 안 부르면 증거 없음 → 통과.
    HK('anon.md', { region: 'Lantau Island', ...SHEUNG_YIU, address: 'Somewhere, Hong Kong' }),
  ];
  const hits = findRegionOutliers(posts);
  assert.deepEqual(hits.map((h) => h.post.file), ['lantau-island-sheung-yiu-folk-museum.md']);
  assert.deepEqual(hits[0].evidence, { kind: 'address', region: 'Sai Kung' });
  assert.equal(hits[0].peers, 3); // 거리 정보는 붙지만 판정에 쓰이지 않았다
});

test('전체 말뭉치: 부모·자식 구역의 이름은 증거가 아니다 — 멀리 떨어졌을 때만(1b)', () => {
  const TW = (file, extra) => ({ file, country: 'Taiwan', draft: false, inScope: false, ...extra });
  const posts = [
    TW('sml-1.md', { region: 'Sun Moon Lake', lat: 23.857, lng: 120.915, address: 'Yuchi Township, Nantou County, Taiwan' }),
    TW('sml-2.md', { region: 'Sun Moon Lake', lat: 23.860, lng: 120.910, address: 'Sun Moon Lake, Nantou County, Taiwan' }),
    TW('sml-3.md', { region: 'Sun Moon Lake', lat: 23.850, lng: 120.920, address: 'Yuchi Township, Nantou County, Taiwan' }),
    TW('nt-1.md', { region: 'Nantou', lat: 23.91, lng: 120.68, address: 'Nantou City, Nantou County, Taiwan' }),
    // 호수 옆 글: 주소가 Nantou 를 부르지만 Nantou 는 Sun Moon Lake 의 부모 → 통과.
    TW('sml-pagoda.md', { region: 'Sun Moon Lake', lat: 23.845, lng: 120.925, address: 'Ci En Pagoda, Yuchi Township, Nantou County, Taiwan' }),
    // 같은 부모 이름이라도 호수에서 40 km 떨어졌으면 잡는다 (Chiayi PAC / Alishan 사례).
    TW('sml-far.md', { region: 'Sun Moon Lake', lat: 24.15, lng: 120.68, address: 'Some Hall, Nantou County, Taiwan' }),
  ];
  const hits = findRegionOutliers(posts);
  assert.deepEqual(hits.map((h) => h.post.file), ['sml-far.md']);
  assert.equal(hits[0].evidence.region, 'Nantou');
});

test('전체 말뭉치: 넓은 구역의 테두리 안이면 다른 구역명이 있어도 통과 (Provence / Avignon)', () => {
  const FR = (file, extra) => ({ file, country: 'France', draft: false, inScope: false, ...extra });
  const posts = [
    FR('p-1.md', { region: 'Provence', lat: 43.53, lng: 5.45, address: 'Aix-en-Provence, France' }),
    FR('p-2.md', { region: 'Provence', lat: 43.83, lng: 4.36, address: 'Nîmes, France' }),
    FR('p-3.md', { region: 'Provence', lat: 43.68, lng: 4.63, address: 'Arles, France' }),
    FR('p-4.md', { region: 'Provence', lat: 43.29, lng: 5.37, address: 'Marseille, France' }),
    FR('a-1.md', { region: 'Avignon', lat: 43.95, lng: 4.81, address: '84000 Avignon, France' }),
    FR('provence-palais-des-papes.md', { region: 'Provence', lat: 43.951, lng: 4.807, address: 'Place du Palais, 84000 Avignon, France' }),
  ];
  assert.deepEqual(findRegionOutliers(posts), []);
});

test('전체 말뭉치: 다른 구역 무리 한가운데 앉은 글은 주소가 말이 없어도 잡는다', () => {
  const SG = (file, extra) => ({ file, country: 'Singapore', draft: false, inScope: false, address: '', ...extra });
  const posts = [
    SG('cq-1.md', { region: 'Clarke Quay', lat: 1.2906, lng: 103.8465 }),
    SG('cq-2.md', { region: 'Clarke Quay', lat: 1.2910, lng: 103.8470 }),
    SG('cq-3.md', { region: 'Clarke Quay', lat: 1.2900, lng: 103.8460 }),
    SG('mb-1.md', { region: 'Marina Bay', lat: 1.2816, lng: 103.8636 }),
    SG('mb-2.md', { region: 'Marina Bay', lat: 1.2850, lng: 103.8607 }),
    SG('mb-3.md', { region: 'Marina Bay', lat: 1.2833, lng: 103.8590 }),
    // ArtScience Museum: region Clarke Quay, 좌표는 Marina Bay 글들 옆(1.6 km / 0.5 km).
    SG('clarke-quay-artscience-museum.md', { region: 'Clarke Quay', lat: 1.2863, lng: 103.8593, address: '6 Bayfront Ave, Singapore 018974' }),
  ];
  const hits = findRegionOutliers(posts);
  assert.deepEqual(hits.map((h) => h.post.file), ['clarke-quay-artscience-museum.md']);
  assert.equal(hits[0].evidence.kind, 'cluster');
  assert.equal(hits[0].evidence.region, 'Marina Bay');
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
  // 드래프트가 이웃으로 셌다면 중앙점이 사이궁 쪽으로 끌려가 거리값이 흐려진다.
  assert.equal(hits.find((h) => h.post.file === 'live-wrong.md').peers, 4);
});

test('배치 뒤집힘 방지: 이번 발행분 n편은 피어가 아니다 — n=1..5 전부 붙든다', () => {
  // 커밋된 글 3편은 (0, 0) 근처, 다른 구역 "Farside" 의 커밋된 무리 3편은 위도 0.2
  // (≈ 22 km) 근처. 새 글 n편은 그 무리 안에 앉아 있고 주소는 아무 구역도 부르지
  // 않는다 — 좌표 경로만 남는 경우.
  const base = (file, extra) => ({ file, country: 'Flatland', draft: false, inScope: false, address: 'Somewhere, Flatland', ...extra });
  const committed = [
    base('c-0.md', { region: 'Near', lat: 0, lng: 0 }),
    base('c-1.md', { region: 'Near', lat: 0.01, lng: 0 }),
    base('c-2.md', { region: 'Near', lat: -0.01, lng: 0 }),
    base('f-0.md', { region: 'Farside', lat: 0.2, lng: 0.005 }),
    base('f-1.md', { region: 'Farside', lat: 0.205, lng: 0 }),
    base('f-2.md', { region: 'Farside', lat: 0.195, lng: -0.005 }),
  ];
  const fresh = (n, inScope) => Array.from({ length: n }, (_, i) => base(`new-${i}.md`, {
    region: 'Near', lat: 0.2 + i * 0.001, lng: i * 0.001, inScope,
  }));
  for (let n = 1; n <= 5; n++) {
    const hits = findRegionOutliers([...committed, ...fresh(n, true)]).map((h) => h.post.file).sort();
    assert.deepEqual(hits, fresh(n, true).map((p) => p.file).sort(), `n=${n}: expected every new post held, got ${hits}`);
  }
  // 역방향: 새 글을 피어로 세면(inScope 없이) n=4 부터 중앙점이 새 무리로
  // 넘어가 전부 통과한다 — 코덱스가 지적한 뒤집힘 그대로.
  assert.equal(findRegionOutliers([...committed, ...fresh(4, false)]).length, 0);
});

test('고정 표본: 09-02 수리 전 24편을 이번 발행분으로 재생하면 14편이 잡힌다', () => {
  // scripts/lib/fixtures/region-outlier-2026-09-02.json — bdec9f80^ 시점, 구역
  // 단위 5개국의 라이브 글 351편(country/region/address/lat/lng). inScope=24편.
  const fx = JSON.parse(readFileSync(new URL('./fixtures/region-outlier-2026-09-02.json', import.meta.url), 'utf8'));
  const posts = fx.posts.map((p) => ({ ...p, draft: false, inScope: !!p.inScope }));
  const hits = findRegionOutliers(posts).filter((h) => h.post.inScope).map((h) => h.post.file.replace(/\.md$/, '')).sort();
  const expected = [
    'alishan-alishan-forest-railway-garage-park',   // 1b: Chiayi 는 Alishan 의 부모지만 40 km
    'alishan-chiayi-performing-arts-center',        // 1b
    'bugis-supertree-grove',                        // cluster: Marina Bay
    'central-avenue-of-stars-hk',                   // address: Tsim Sha Tsui
    'clarke-quay-artscience-museum',                // cluster: Marina Bay
    'fujairah-shees-park',                          // address: Sharjah
    'jordan-hong-kong-heritage-museum',             // address: Sha Tin
    'jordan-victoria-peak-garden',                  // cluster: Central
    'kampong-glam-telok-blangah-hill-park',         // cluster: Sentosa
    'lantau-island-sheung-yiu-folk-museum',         // address: Sai Kung
    'orchard-road-maxwell-food-centre',             // cluster: Chinatown
    'phuket-phi-phi-islands',                       // address: Krabi
    'sai-kung-hong-kong-space-museum',              // address: Tsim Sha Tsui
    'sha-tin-hong-kong-science-museum',             // address: Tsim Sha Tsui
  ];
  // 못 잡는 10편(주소가 어떤 라이브 구역도 안 부르고, 3편 이상 무리 안에 있지도
  // 않다): al-barsha-dubai-gold-souk(Al Ras) · al-barsha-hindu-temple-dubai(Jebel Ali)
  // · saadiyat-island-hudayriyat-island · dempsey-hill-pasar-geylang-serai("Singapore")
  // · bugis-lee-kong-chian…(Conservatory Dr) · jumeirah-dubai-old-village(Al Hamriya)
  // · east-coast-national-museum-of-singapore(Stamford Rd) · jordan-jordan-valley-park
  // (Cha Liu Au) · jumeirah-zabeel-park(Zabeel) · tiong-bahru-national-gallery-singapore.
  // 얇은 구역에 "무리 근접만으로" 잡는 시도는 라이브 29편을 오탐했다(09-03).
  assert.deepEqual(hits, expected);
  // 같은 표본에서 이미 라이브였던 글은 오탐 후보 — 당시 진짜 오배정만 남아야 한다.
  // Man Mo Temple(Hollywood Rd, Sheung Wan → "Central"), Flower Dome(Marina Bay →
  // "Sentosa"), Graham Street Market(Central → "Sheung Wan")은 진짜 오배정.
  // Monkey Bay 는 표본의 한계: 당시 Koh Phi Phi 커밋 글 2편 중 1편만 주소에
  // Krabi 를 담아 Krabi 가 부모로 학습되지 않았다(현재 트리에선 3편 중 2편 → 부모).
  const live = findRegionOutliers(posts).filter((h) => !h.post.inScope).map((h) => h.post.file.replace(/\.md$/, '')).sort();
  assert.deepEqual(live, ['central-man-mo-temple', 'koh-phi-phi-monkey-bay', 'sentosa-flower-dome', 'sheung-wan-graham-street-market']);
});
