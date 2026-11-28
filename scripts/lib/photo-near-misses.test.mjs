import test from 'node:test';
import assert from 'node:assert/strict';
import { oneEditApart, namesSubjectNotVantage, commonsCandidates, commonsRanked, tokens, TYPO_NEAR_KM } from './commons.mjs';
import { rankVenueHits, topHitIsTied, exactNameAtSpot, pickVenueHit, fsqVenuePhotos } from './photo-sources.mjs';

// 2026-11-28, 픽서님: "사진이 들어갈 만한데 안 들어간 곳이 많다." 사진 없는 공개 글을
// 재 보니 무료 사진이 실제로 있는데 우리 규칙이 못 본 경우가 네 갈래였다. 각 갈래마다
// "이제 찾는다"와 "그래도 남의 사진은 안 받는다"를 같이 고정한다.

test('한 글자 틀린 긴 낱말만 같은 낱말로 본다', () => {
  assert.ok(oneEditApart('sockcho', 'sokcho'));   // 한 글자 더
  assert.ok(oneEditApart('sokcho', 'sockcho'));
  assert.ok(oneEditApart('lighthous', 'lighthouse'));
  assert.ok(oneEditApart('gyeongju', 'gyeongiu'));  // 한 글자 바뀜
  // 짧은 낱말·첫 글자 다름·두 글자 차이는 아니다
  assert.ok(!oneEditApart('seoul', 'seol'));
  assert.ok(!oneEditApart('busan', 'pusan'));
  assert.ok(!oneEditApart('sokcho', 'sackcho'));
  assert.ok(!oneEditApart('nudake', 'nudake'), '같은 낱말은 오타 규칙이 아니라 그냥 일치로 잡힌다');
});

test('오타 허용은 부를 때만 켜진다 — 기본 이름 검사는 그대로다', () => {
  assert.equal(namesSubjectNotVantage('Sockcho Lighthouse 2', 'Sokcho Lighthouse'), false);
  assert.equal(namesSubjectNotVantage('Sockcho Lighthouse 2', 'Sokcho Lighthouse', { typo: true }), true);
  // 오타를 허용해도 시점 규칙은 산다: 등대에서 찍은 시내 사진은 등대 사진이 아니다
  assert.equal(namesSubjectNotVantage('Sokcho from the Lighthouse Observatory 1', 'Sokcho Lighthouse', { typo: true }), true,
    '이름 낱말 둘 다 있다 — 시점 판정은 첫 낱말 앞을 본다');
  assert.equal(namesSubjectNotVantage('View from Sockcho Lighthouse', 'Sokcho Lighthouse', { typo: true }), false);
});

test('고를 때는 이름의 모든 낱말 앞을 본다 — "속초 시내, 등대 전망대에서"는 등대 사진이 아니다', () => {
  const s = 'Sokcho Lighthouse';
  assert.equal(namesSubjectNotVantage('Sokcho from the Lighthouse Observatory 1', s, { everyWord: true }), false);
  assert.equal(namesSubjectNotVantage('Sockcho Lighthouse 2', s, { everyWord: true, typo: true }), true);
  assert.equal(namesSubjectNotVantage('Sokcho Lighthouse seen from Sokcho beach', s, { everyWord: true }), true);
  // 이름 자체에 든 by·from 은 시점이 아니다
  assert.equal(namesSubjectNotVantage('Supertree Grove, Gardens by the Bay, Singapore1', 'Gardens by the Bay', { everyWord: true }), true);
  assert.equal(namesSubjectNotVantage('The View From the Shard (8367215057)', 'The View from The Shard', { everyWord: true }), true);
  assert.equal(namesSubjectNotVantage('Gigantic Sculptures by Merab Phiranishvili', 'Gigantic Sculptures by Merab Phiranishvili.', { everyWord: true }), true);
});

test('역방향: 걸려 있는 대표사진을 감사하는 기본 판정은 첫 낱말만 본다 (라이브 사진을 떼지 않는다)', () => {
  // 11-28 측정: 모든 낱말 판정을 감사에도 쓰면 라이브 대표사진 7장이 새로 "시점"으로 걸려
  // audit-hero-titles --fix 가 떼어 냈을 것이다. 감사는 예전 판정 그대로.
  assert.equal(namesSubjectNotVantage('View of Banff from Gondola (3910774143)', 'Banff Gondola'), true);
  assert.equal(namesSubjectNotVantage('Sokcho from the Lighthouse Observatory 1', 'Sokcho Lighthouse'), true);
});

// Commons 응답 흉내: 파일마다 제목·좌표·크기.
const page = (title, lat, lng, i) => ({
  title: `File:${title}.jpg`, index: i,
  coordinates: lat == null ? undefined : [{ lat, lon: lng }],
  imageinfo: [{
    mime: 'image/jpeg', url: `https://upload.wikimedia.org/x/${i}.jpg`, thumburl: `https://upload.wikimedia.org/x/${i}.jpg`,
    width: 2400, height: 1600, thumbwidth: 2400, thumbheight: 1600,
    descriptionurl: `https://commons.wikimedia.org/wiki/File:${i}.jpg`,
    extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: 'x' } },
  }],
});
// pages: an array (every search answers the same), or a function of the
// search string returning one.
async function withCommons(pagesOrFn, fn) {
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(decodeURIComponent(String(url)));
    const pages = typeof pagesOrFn === 'function' ? pagesOrFn(new URL(String(url)).searchParams.get('gsrsearch') || '') : pagesOrFn;
    // The real API's colimit is a cap on the whole answer: colimit=1 geotags
    // ONE file. A mock that geotagged every file whatever was asked would pass
    // the bug that hid 13 of 14 coordinates (checks-that-ran-empty, 11-19).
    const cap = new URL(String(url)).searchParams.get('colimit');
    const n = cap === 'max' ? Infinity : Number(cap || 10);
    let given = 0;
    const answer = pages.map((p) => (p.coordinates && given++ < n ? p : { ...p, coordinates: undefined }));
    return new Response(JSON.stringify({ query: { pages: Object.fromEntries(answer.map((p, i) => [i, p])) } }), { status: 200 });
  };
  try { return await fn(asked); } finally { globalThis.fetch = real; }
}

const SOKCHO = { lat: 38.2137364, lng: 128.599974 };
test('속초등대: 철자 틀린 파일도 등대 바로 옆에서 찍혔으면 후보가 된다', async () => {
  const got = await withCommons([
    page('Sockcho Lighthouse 2', 38.21378, 128.59992, 0),           // 5 m
    page('Sockcho Lighthouse far', 38.2400, 128.5900, 1),           // 약 3 km 밖 — 반경 밖
  ], () => commonsCandidates('Sokcho Lighthouse', 10, 'Sokcho Lighthouse', SOKCHO, { region: 'Sokcho' }));
  assert.deepEqual(got.map((c) => c.title), ['Sockcho Lighthouse 2']);
});

test('촬영 좌표가 장소 옆인 파일이 검색 순위보다 앞선다 — 1.2km 밖 방파제 등대보다 11m 옆 등대', async () => {
  const got = await withCommons([
    page('Red lighthouse in Sokcho', null, null, 0),
    page('Lighthouse in Sokcho', 38.221569, 128.591142, 1),           // 1.2 km — 반경 안, 다른 등대
    page('Sokcho from the Lighthouse Observatory 1', 38.2139, 128.6001, 2), // 등대에서 본 시내
    page('Sockcho Lighthouse 1', 38.213786, 128.599869, 3),           // 11 m
  // The venue path asks with a cross-check (≥2 shared words with name+region,
  // images.mjs venueGuard) — the misspelt word must count there too, or the
  // file is let in and then thrown out one step later.
  ], () => commonsRanked('Sokcho Lighthouse Sokcho', { subject: 'Sokcho Lighthouse', near: SOKCHO, region: 'Sokcho', crossCheck: tokens('Sokcho Lighthouse Sokcho'), minCross: 2, mustInclude: ['sokcho'] }));
  assert.equal(got[0].title, 'Sockcho Lighthouse 1');
  assert.ok(!got.some((c) => /Observatory/.test(c.title)), '등대에서 본 풍경은 고르지 않는다');
});

test('역방향: 3km 반경 밖에 찍힌 파일은 순위가 몇 번째든 빠진다 (좌표를 전부 받아야 가능)', async () => {
  const got = await withCommons([
    page('Sokcho Lighthouse old', 38.2137, 128.6000, 0),              // 옆
    page('Sokcho Lighthouse elsewhere', 38.30, 128.55, 1),            // 약 10 km
    page('Sokcho Lighthouse far 2', 38.32, 128.52, 2),
  ], () => commonsCandidates('Sokcho Lighthouse', 10, 'Sokcho Lighthouse', SOKCHO, { region: 'Sokcho' }));
  assert.deepEqual(got.map((c) => c.title), ['Sokcho Lighthouse old']);
});

test('역방향: 반경 안이라도 300m 밖이거나 좌표 없는 오타 파일은 받지 않는다', async () => {
  assert.ok(TYPO_NEAR_KM <= 0.3);
  const got = await withCommons([
    page('Sockcho Lighthouse 1', 38.2180, 128.6000, 0),              // 약 480 m — 3km 반경 안, 오타 허용 거리 밖
    page('Sockcho Lighthouse 3', null, null, 1),                     // 좌표 없음
    page('Sokcho Lighthouse', null, null, 2),                        // 철자 맞음 — 원래대로 통과
  ], () => commonsCandidates('Sokcho Lighthouse', 10, 'Sokcho Lighthouse', SOKCHO, { region: 'Sokcho' }));
  assert.deepEqual(got.map((c) => c.title), ['Sokcho Lighthouse']);
});

// Commons search wants every word: a query with the bracket finds only files
// whose text carries the bracket's words too.
const everyWordSearch = (files) => (search) => {
  const words = (search.replace(/nearcoord:\S+/, '').match(/[A-Za-z]{3,}/g) || []).map((w) => w.toLowerCase());
  return files.filter((p) => words.every((w) => p.title.toLowerCase().includes(w)));
};
test('괄호 설명 때문에 아무것도 못 찾으면, 괄호를 빼고 다시 찾되 문 앞(50m)에서 찍힌 파일만 받는다', async () => {
  const near = { lat: 47.9000, lng: 106.9000 };
  const name = 'Lanzhou Beef Noodles (Halal restaurant)';
  await withCommons(everyWordSearch([page('Lanzhou Beef Noodles (Khan Uul, Ulaanbaatar)', 47.90001, 106.90002, 0)]), async (asked) => {
    const got = await commonsCandidates(name, 10, name, near, { region: 'Ulaanbaatar' });
    assert.equal(got.length, 1);
    assert.ok(asked.some((u) => u.includes('gsrsearch=Lanzhou Beef Noodles nearcoord:')), asked.join('\n'));
  });
  // 역방향: 괄호를 빼고 찾은 파일이 문 앞이 아니면(좌표 없음·111m) 받지 않는다
  const none = await withCommons(everyWordSearch([
    page('Lanzhou Beef Noodles shop', null, null, 0),
    page('Lanzhou Beef Noodles Sukhbaatar', 47.9010, 106.9000, 1),   // 약 111 m
  ]), () => commonsCandidates(name, 10, name, near, { region: 'Ulaanbaatar' }));
  assert.equal(none.length, 0);
});

test('괄호 포함 검색이 다른 파일을 찾아도, 문 앞 파일은 괄호 없는 검색으로 함께 받는다', async () => {
  const near = { lat: 47.9000, lng: 106.9000 };
  const name = 'Lanzhou Beef Noodles (Halal restaurant)';
  const got = await withCommons(everyWordSearch([
    page('Lanzhou Beef Noodles Halal restaurant Sukhbaatar', 47.9150, 106.9170, 0), // 다른 지점(약 2km) — 괄호 검색에 잡힌다
    page('Lanzhou Beef Noodles (Khan Uul, Ulaanbaatar)', 47.90001, 106.90002, 1),
  ]), () => commonsCandidates(name, 10, name, near, { region: 'Ulaanbaatar' }));
  assert.ok(got.some((c) => /Khan Uul/.test(c.title)), got.map((c) => c.title).join(' | '));
});

test('역방향: 괄호 안이 지점 이름이면 다른 지점 파일을 받지 않는다 (코덱스 11-28, Sakura Coffee East/West)', async () => {
  const near = { lat: 35.0, lng: 135.0 };
  const got = await withCommons(everyWordSearch([page('Sakura Coffee West', 35.0010, 135.0, 0)]), () =>
    commonsCandidates('Sakura Coffee (East)', 10, 'Sakura Coffee (East)', near, { region: 'Kyoto' }));
  assert.equal(got.length, 0);
  // 괄호가 든 이름으로 찾아지는 파일은 예전처럼 받는다(괄호 없는 재검색과 무관)
  const ok = await withCommons(everyWordSearch([page('Sakura Coffee East entrance', null, null, 0)]), () =>
    commonsCandidates('Sakura Coffee (East)', 10, 'Sakura Coffee (East)', near, { region: 'Kyoto' }));
  assert.equal(ok.length, 1);
});

test('역방향: 업종 낱말은 한 글자 차이를 봐주지 않는다 (Hotel ≠ Hostel)', () => {
  assert.equal(namesSubjectNotVantage('Crystal Hostel', 'Crystal Hotel', { typo: true }), false);
  assert.equal(namesSubjectNotVantage('Sockcho Lighthouse 1', 'Sokcho Lighthouse', { typo: true }), true);
});

test('역방향: 이름을 통째로 다시 써도 "~에서 본" 사진은 시점으로 잡힌다', () => {
  assert.equal(namesSubjectNotVantage('Sokcho from the Sokcho Lighthouse', 'Sokcho Lighthouse', { everyWord: true }), false);
  assert.equal(namesSubjectNotVantage('Sokcho Lighthouse seen from Sokcho beach', 'Sokcho Lighthouse', { everyWord: true }), true);
});

test('도시+업종뿐인 이름은 그 이름이 통째로 든 파일만 받는다 (광저우 레스토랑)', async () => {
  const near = { lat: 23.113813, lng: 113.245888 };
  const got = await withCommons([
    page('Tenshin Restaurant in Guangzhou (48393786877)', 23.123168, 113.26284, 0),  // 다른 식당 2km
    page('Guangzhou Restaurant Wenchang Road', 23.1139, 113.2459, 1),
  ], () => commonsCandidates('Guangzhou Restaurant', 10, 'Guangzhou Restaurant', near, { region: 'Guangzhou' }));
  assert.deepEqual(got.map((c) => c.title), ['Guangzhou Restaurant Wenchang Road']);
});

test('역방향: 자기 이름 낱말이 있는 가게는 예전처럼 낱말 검사로 받는다', async () => {
  const near = { lat: 47.9000, lng: 106.9000 };
  const got = await withCommons([page('Noodles Lanzhou Beef, Ulaanbaatar', 47.90001, 106.90002, 0)], () =>
    commonsCandidates('Lanzhou Beef Noodles', 10, 'Lanzhou Beef Noodles', near, { region: 'Ulaanbaatar' }));
  assert.equal(got.length, 1, '순서가 달라도 낱말이 다 있으면 된다');
});

// ── Foursquare ──
const NUDAKE_LEAD = [
  { name: 'NUDAKE (누데이크)', distance: 6769, location: { address: '압구정로46길 50' } },
  { name: 'NUDAKE (누데이크)', distance: 6295, location: { address: '강남대로162길 43' } },
  { name: 'Nudake Teahouse (누데이크 티하우스)', distance: 7744, location: { address: '뚝섬로 433' } },
];
test('누데이크: 같은 브랜드 세 곳 중 우리 이름을 가장 많이 담은 곳이 앞선다', () => {
  const ranked = rankVenueHits('NUDAKE Tea House (Seongsu)', 'Seoul, South Korea', NUDAKE_LEAD);
  assert.equal(ranked[0].r.name, 'Nudake Teahouse (누데이크 티하우스)');
  assert.ok(!topHitIsTied(ranked));
  assert.equal(pickVenueHit('NUDAKE Tea House (Seongsu)', 'Seoul, South Korea', NUDAKE_LEAD).name, 'Nudake Teahouse (누데이크 티하우스)');
});

test('역방향: 괄호에 다른 지점이 적힌 곳은 이름을 많이 담아도 빠진다 (코덱스 11-28)', () => {
  const ranked = rankVenueHits('NUDAKE Tea House (Seongsu)', 'Seoul, South Korea', [
    { name: 'NUDAKE', distance: 100 }, { name: 'Nudake Teahouse (Apgujeong)', distance: 350 },
  ]);
  assert.deepEqual(ranked.map((h) => h.r.name), ['NUDAKE']);
});

test('역방향: 50m 예외도 지점 괄호를 보고, 가장 가까운 곳을 고른다 (코덱스 11-28)', () => {
  assert.equal(exactNameAtSpot('The Coffee House (North Wing)', [{ name: 'The Coffee House (South Wing)', distance: 20 }]), null);
  assert.equal(exactNameAtSpot('The Coffee House', [{ name: 'The Coffee House', distance: 40 }, { name: 'The Coffee House', distance: 3 }]).distance, 3);
  // 다른 글자로 쓴 같은 이름 괄호는 괜찮다
  assert.ok(exactNameAtSpot('Museum 1', [{ name: 'MUSEUM 1', distance: 6 }]));
});

test('역방향: 이름만으로 지점을 못 가르면 동률로 본다 (치폴레 강남)', () => {
  const ranked = rankVenueHits('Chipotle Gangnam', 'Seoul, South Korea', [
    { name: 'Chipotle (치폴레)', distance: 8427 },
    { name: 'Chipotle', distance: 7257 },
    { name: 'Chipotle Mexican Grill', distance: 7195 },
  ]);
  assert.ok(ranked.length >= 2);
  assert.ok(topHitIsTied(ranked));
});

test('뮤지엄원: 같은 이름이 우리 좌표 50m 안에 있을 때만 이름 낱말 없이 받는다', () => {
  const rs = [{ name: 'Museum Da', distance: 6 }, { name: 'Museum 1', distance: 6 }, { name: 'Museum 1', distance: 111 }];
  assert.equal(exactNameAtSpot('MUSEUM 1', rs)?.distance, 6);
  assert.equal(exactNameAtSpot('MUSEUM 1', [{ name: 'Museum 1', distance: 111 }]), null, '111m — 다른 곳일 수 있다');
  assert.equal(exactNameAtSpot('MUSEUM 1', [{ name: 'Museum Da', distance: 6 }]), null);
  assert.equal(exactNameAtSpot('MUSEUM 1', [{ name: 'Museum 1' }]), null, '거리를 모르면 증거가 없다');
});

// fsqVenuePhotos 전체 흐름: 첫 검색이 빗나가면 첫 낱말로 한 번 더 묻는다.
async function withFsq(answers, fn) {
  const real = globalThis.fetch;
  const realKey = process.env.FOURSQUARE_API_KEY;
  process.env.FOURSQUARE_API_KEY = 'test';
  const asked = [];
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    asked.push(u.pathname + u.search);
    if (u.pathname.endsWith('/photos')) return new Response(JSON.stringify([{ prefix: 'https://fastly.4sqi.net/img/general/', suffix: '/p.jpg', width: 1600, height: 1200 }]), { status: 200 });
    const q = u.searchParams.get('query');
    return new Response(JSON.stringify({ results: answers[q] || [] }), { status: 200 });
  };
  try { return await fn(asked); } finally {
    globalThis.fetch = real;
    if (realKey === undefined) delete process.env.FOURSQUARE_API_KEY; else process.env.FOURSQUARE_API_KEY = realKey;
  }
}
const withId = (rs) => rs.map((r, i) => ({ ...r, fsq_place_id: `id${i}` }));

test('첫 검색이 남의 가게만 주면 첫 낱말로 다시 찾아 맞는 곳의 사진을 받는다', async () => {
  await withFsq({
    'NUDAKE Tea House': withId([{ name: 'OSULLOC Tea House (오설록)', distance: 441 }]),
    nudake: withId(NUDAKE_LEAD),
  }, async (asked) => {
    const got = await fsqVenuePhotos({ name: 'NUDAKE Tea House (Seongsu)', near: 'Seoul, South Korea' });
    assert.equal(got.length, 1);
    assert.match(got[0].credit, /Nudake Teahouse/);
    assert.ok(asked.some((a) => a.includes('/places/id2/photos')), asked.join('\n'));
  });
});

test('역방향: 다시 찾아도 지점이 동률이면 사진을 받지 않는다', async () => {
  await withFsq({
    'Chipotle Gangnam': withId([{ name: 'Gangnam Myeonok (강남면옥)', distance: 576 }]),
    chipotle: withId([{ name: 'Chipotle (치폴레)', distance: 8427 }, { name: 'Chipotle', distance: 7257 }]),
  }, async (asked) => {
    const got = await fsqVenuePhotos({ name: 'Chipotle Gangnam', near: 'Seoul, South Korea' });
    assert.deepEqual(got, []);
    assert.ok(!asked.some((a) => a.includes('/photos')));
  });
});

test('역방향: 다시 찾은 결과도 이름 검사를 그대로 받는다 — 첫 낱말만 같은 남의 가게는 안 된다', async () => {
  await withFsq({
    'Atelier Kau Lou': [],
    atelier: withId([{ name: 'Atelier By Taste Buds', distance: 300 }]),
  }, async () => {
    const got = await fsqVenuePhotos({ name: 'Atelier Kau Lou & Opia', near: 'Shanghai, China' });
    assert.deepEqual(got, []);
  });
});

test('역방향: 다시 찾기에서 첫 낱말 하나뿐인 이름의 가게는 받지 않는다 (상하이 Atelier)', async () => {
  await withFsq({
    'Atelier Kau Lou': [],
    atelier: withId([{ name: 'Atelier', distance: 900 }]),
  }, async () => {
    assert.deepEqual(await fsqVenuePhotos({ name: 'Atelier Kau Lou & Opia', near: 'Shanghai, China' }), []);
  });
  // 한 낱말 이름은 그 낱말 그대로인 가게를 받는다
  await withFsq({
    'Restaurant Caravan': [],
    caravan: withId([{ name: 'Caravan', distance: 2000 }]),
  }, async () => {
    const got = await fsqVenuePhotos({ name: 'Restaurant Caravan', near: 'Tashkent, Uzbekistan' });
    assert.equal(got.length, 1);
  });
});

test('좌표가 있는 이름 낱말 없는 장소는 같은 이름이 50m 안에 있을 때만 사진을 받는다', async () => {
  await withFsq({ 'MUSEUM 1': withId([{ name: 'Museum Da', distance: 6 }, { name: 'Museum 1', distance: 6 }]) }, async () => {
    const got = await fsqVenuePhotos({ name: 'MUSEUM 1', lat: 35.17, lng: 129.12 });
    assert.equal(got.length, 1);
    assert.match(got[0].credit, /Museum 1/);
  });
  await withFsq({ 'MUSEUM 1': withId([{ name: 'Museum 1', distance: 300 }]) }, async () => {
    assert.deepEqual(await fsqVenuePhotos({ name: 'MUSEUM 1', lat: 35.17, lng: 129.12 }), []);
  });
});
