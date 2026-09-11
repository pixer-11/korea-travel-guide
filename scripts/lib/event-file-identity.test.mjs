// 이벤트 히어로 파일명 신원 검사 — 양방향 회귀 테스트.
// 2026-08-22: 장소(venue) 검색이 찾아온 12편 전부가 "다른 출연자"로 버려졌다
// ("remote view", "exterior", "aerial view"가 출연자 이름으로 읽혔다). 반대로
// 진짜 다른 출연자("Mayday … Concert", "Cirque du Soleil")는 계속 막혀야 한다.
//   node scripts/lib/event-file-identity.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foreignInFilename, geoTokens } from './event-file-identity.mjs';
import { tokens, keyToken } from './commons.mjs';
import { readFileSync } from 'node:fs';
import { eventProperName } from '../../src/lib/eventName.mjs';

const U = (f) => `https://upload.wikimedia.org/wikipedia/commons/a/b/${encodeURIComponent(f)}`;
const known = (...parts) => new Set(parts.flatMap((p) => tokens(p)));

// 실제 판정 한 번: 제목에서 앵커를 뽑고, 진짜 세계 지명 집합을 쓰고, act 경로로
// 묻는다 — 앵커 검색이 물어온 파일이 지나는 바로 그 경로다.
const WORLD = JSON.parse(readFileSync('data/countries.json', 'utf8'));
const REAL_GEO = geoTokens({
  regions: (WORLD.countries || []).flatMap((c) => c.regions || []),
  countries: (WORLD.countries || []).map((c) => c.name),
});
const actVerdict = (title, region, country, file) => foreignInFilename(U(file), {
  known: known(title, region, country),
  anchor: keyToken(title, `${region} ${country}`),
  via: 'act',
  geo: REAL_GEO,
  name: eventProperName(title),
});

test('venue finds: scene words are not another act', () => {
  const k = known('PLK Stade de France Concerts', 'Paris', 'France', 'Stade de France');
  assert.equal(foreignInFilename(U('Remote_view_of_Stade_de_France_(49445778188).jpg'), { known: k, via: 'venue' }), '');
  const k2 = known('EDC Korea', 'Incheon', 'South Korea', 'INSPIRE Entertainment Resort');
  assert.equal(foreignInFilename(U('3840px-Inspire_Entertainment_Resort_Exterior.jpg'), { known: k2, via: 'venue' }), '');
  const k3 = known('Formula 1 United States Grand Prix', 'Austin', 'United States', 'Circuit of the Americas');
  assert.equal(foreignInFilename(U('3840px-Circuit_of_the_Americas_aerial_view_from_WN4430.jpg'), { known: k3, via: 'venue' }), '');
  const k4 = known('Vietnamese Super Cup', 'Hanoi', 'Vietnam', 'Hàng Đẫy Stadium');
  assert.equal(foreignInFilename(U('Hang_Day.jpg'), { known: k4, via: 'venue' }), '');
});

test('venue finds: another act at the venue is still refused', () => {
  const k = known('Official HIGE DANDism Asia Tour', 'Taipei', 'Taiwan', 'Taipei Dome');
  assert.notEqual(foreignInFilename(U('3840px-Mayday_Taipei_Dome_Concert.jpg'), { known: k, via: 'venue' }), '');
  const k2 = known('PLK Stade de France Concerts', 'Paris', 'France', 'Stade de France');
  assert.notEqual(foreignInFilename(U('Central_Tour_Indochine_Paris_Stade_de_France.jpg'), { known: k2, via: 'venue' }), '');
  const k3 = known('Formula 1 United States Grand Prix', 'Austin', 'United States', 'Circuit of the Americas');
  assert.notEqual(foreignInFilename(U('Cirque_du_Soleil_at_Circuit_of_the_Americas_2015.jpg'), { known: k3, via: 'venue' }), '');
});

test('phrase finds: the event name itself passes, a sibling event does not', () => {
  const k = known('Hue Festival 2026 - Autumn Festival', 'Hue', 'Vietnam');
  assert.equal(foreignInFilename(U('Festival_Huế.jpg'), { known: k, via: 'phrase' }), '');
  const k2 = known('Asian Games 2026', 'Nagoya', 'Japan');
  assert.notEqual(foreignInFilename(U('3840px-Penutupan_Para_Asian_Games_2018.jpg'), { known: k2, via: 'phrase' }), '');
  // A past host city is WHERE, not WHO — but only with the geo set, and only
  // for phrase/venue finds.
  const geo = geoTokens({ regions: ['Hangzhou', 'Nagoya'], countries: ['China', 'Japan'] });
  assert.equal(foreignInFilename(U('Hangzhou_2022_Asian_Games_opening.jpg'), { known: k2, via: 'phrase', geo }), '');
  assert.notEqual(foreignInFilename(U('Hangzhou_2022_Asian_Games_opening.jpg'), { known: k2, via: 'phrase' }), '');
  assert.notEqual(foreignInFilename(U('Hangzhou_2022_Asian_Games_opening.jpg'), { known: k2, anchor: '', geo }), '');
});

test('act finds keep the strict rule (the Post Malone / F1 Rocks case)', () => {
  const k = known('Post Malone – BIG ASS World Tour', 'Singapore', 'Singapore');
  assert.notEqual(foreignInFilename(U('F1_Rocks_Singapore.jpg'), { known: k, anchor: 'malone' }), '');
  assert.equal(foreignInFilename(U('Post_Malone_at_Rolling_Loud_2019.jpg'), { known: k, anchor: 'malone' }), '');
  const k2 = known('F✦FOREVER Tour', 'Seoul', 'South Korea');
  assert.notEqual(foreignInFilename(U('After_Forever_Circo_Voador.jpg'), { known: k2, anchor: 'forever' }), '');
});

// 2026-08-30: 파일 이름이 행사의 이름 전체를 그대로 담고 있는데도 거절됐다.
// Commons의 "Face Piercing Phuket Vegetarian Festival NN.jpg" 약 35장(4912x3264,
// CC BY)이 전부 "다른 출연자(face piercing)"로 버려졌다 — phrase/venue 분기가
// 앵커 포함 규칙보다 먼저 return 해버리기 때문. 반대 방향("Penutupan Para Asian
// Games" = 형제 행사, "Vegetarian Festival Kuala Lumpur" = 다른 도시의 같은 축제)은
// 계속 막혀야 한다. 느슨해진 신원 검사는 남의 사진을 히어로로 올린다.
test('phrase/venue finds: a file that names the whole event tolerates scene leftovers', () => {
  const k = known('Phuket Vegetarian Festival', 'Phuket', 'Thailand');
  const name = 'Phuket Vegetarian Festival';
  const geo = geoTokens({ regions: ['Phuket'], countries: ['Thailand'] });
  for (const via of ['phrase', 'venue']) {
    assert.equal(
      foreignInFilename(U('Face_Piercing_Phuket_Vegetarian_Festival_12.jpg'), { known: k, via, name, geo }), '',
      `${via}: the filename carries the event's whole name`);
  }
  // 연도가 이름 사이에 끼어도 같은 파일이다.
  assert.equal(foreignInFilename(U('Phuket_2015_Vegetarian_Festival_procession.jpg'), { known: k, via: 'phrase', name, geo }), '');
});

test('name containment does not excuse a sibling event or another city', () => {
  // "Asian Games"는 전부 불용어라 형제 행사("Para Asian Games")가 이름을 통째로
  // 품는다 — 이름 포함만으로는 신원이 되지 않는 경우.
  const k = known('Asian Games 2026', 'Nagoya', 'Japan');
  assert.notEqual(
    foreignInFilename(U('3840px-Penutupan_Para_Asian_Games_2018.jpg'), { known: k, via: 'phrase', name: 'Asian Games 2026' }), '');
  // 같은 축제라도 도시가 다르면 다른 행사다 — 이름의 일부만 들어 있다.
  const k2 = known('Phuket Vegetarian Festival', 'Phuket', 'Thailand');
  assert.notEqual(
    foreignInFilename(U('Vegetarian_Festival_Kuala_Lumpur_dragon_dance.jpg'), { known: k2, via: 'phrase', name: 'Phuket Vegetarian Festival' }), '');
});

test('name containment does not reopen the documented venue refusals', () => {
  const k = known('Official HIGE DANDism Asia Tour', 'Taipei', 'Taiwan', 'Taipei Dome');
  assert.notEqual(foreignInFilename(U('3840px-Mayday_Taipei_Dome_Concert.jpg'), { known: k, via: 'venue', name: 'Official HIGE DANDism Asia Tour' }), '');
  const k2 = known('PLK Stade de France Concerts', 'Paris', 'France', 'Stade de France');
  assert.notEqual(foreignInFilename(U('Central_Tour_Indochine_Paris_Stade_de_France.jpg'), { known: k2, via: 'venue', name: 'PLK Stade de France Concerts' }), '');
  const k3 = known('Formula 1 United States Grand Prix', 'Austin', 'United States', 'Circuit of the Americas');
  assert.notEqual(foreignInFilename(U('Cirque_du_Soleil_at_Circuit_of_the_Americas_2015.jpg'), { known: k3, via: 'venue', name: 'Formula 1 United States Grand Prix' }), '');
  // 이름이 한 단어뿐이면 포함 규칙은 켜지지 않는다 — 앵커 한 토큰 통과와 같아진다.
  const k4 = known('F✦FOREVER Tour', 'Seoul', 'South Korea');
  assert.notEqual(foreignInFilename(U('After_Forever_Circo_Voador.jpg'), { known: k4, via: 'phrase', name: 'FOREVER' }), '');
});

// 2026-08-30: 하이픈이 든 앵커는 파일 이름과 영원히 만나지 못했다.
// keyToken은 "U-Know … Yunho"의 앵커를 "u-know"로 통째로 남긴다 — 의미 없는
// "know"로 떨어지지 않게. 그런데 fileTokens는 tokens()를 거치고, tokens()는
// 하이픈을 공백으로 바꾼다 → 파일 토큰에는 하이픈이 든 토큰이 존재할 수 없고,
// ft.includes(anchor)는 하이픈 앵커에 대해 상시 false. 정작 그 출연자를 찍은
// 사진이 "다른 출연자"로 거절된다(오늘 기준 이벤트 1편, 조용하고 영구적).
// 반대 방향이 이 수정의 안전선이다: 짧은 조각("u")을 그냥 버리고 "know"만
// 보면, Commons가 실제로 물어오는 "Do you know? - DPLA" 스캔 도서 페이지가
// 그대로 통과한다.
test('a hyphenated anchor still meets the file that names the act', () => {
  const title = 'U-KNOW Project 26';
  const anchor = keyToken(title, 'Ho Chi Minh City Vietnam');
  assert.equal(anchor, 'u-know', 'keyToken은 하이픈 선두 단어를 통째로 남긴다');
  const k = known(title, 'Ho Chi Minh City', 'Vietnam');
  assert.equal(foreignInFilename(U('U-Know_Yunho_at_SMTOWN_LIVE_2023.jpg'), { known: k, anchor }), '');
  // 하이픈을 밑줄/공백으로 적어도 같은 이름이다(위키미디어는 공백을 _ 로 쓴다).
  assert.equal(foreignInFilename(U('U_Know_Yunho_2019.jpg'), { known: k, anchor }), '');
  // 조각을 흘리면 안 되는 쪽.
  assert.notEqual(foreignInFilename(U('Do_you_know_-_DPLA_-_5f3a9c1.jpg'), { known: k, anchor }), '');
  assert.notEqual(foreignInFilename(U('Knowledge_is_power_mural_Bangkok.jpg'), { known: k, anchor }), '');
});

test('the hyphen escape does not reopen the documented refusals', () => {
  const k = known('Post Malone – BIG ASS World Tour', 'Singapore', 'Singapore');
  assert.notEqual(foreignInFilename(U('F1_Rocks_Singapore.jpg'), { known: k, anchor: 'malone' }), '');
  const k2 = known('F✦FOREVER Tour', 'Seoul', 'South Korea');
  assert.notEqual(foreignInFilename(U('After_Forever_Circo_Voador.jpg'), { known: k2, anchor: 'forever' }), '');
  const k3 = known('Asian Games 2026', 'Nagoya', 'Japan');
  assert.notEqual(foreignInFilename(U('3840px-Penutupan_Para_Asian_Games_2018.jpg'), { known: k3, via: 'phrase' }), '');
});

// 2026-09-10 픽서님: 정기적으로 열리는 행사는 예전 회차 사진이 반드시 있으니 그걸 쓰자.
// 실제로 있었다 — MEFCC 는 2023년 아부다비 회차 군중 사진이 커먼즈 첫 결과인데,
// 우리 검색은 풀네임("Middle East Film & Comic Con")의 앵커 "middle" 로 들어가
// 중동 위성사진·공군 비행·중간자공격 다이어그램 24장을 판정하고 사진 없이 남았다.
// 제목이 괄호로 선언한 약어는 우리가 쓴 이름이므로 신원으로 인정한다.
test('약어로 찾은 파일은 약어가 파일명에 있으면 신원 확인', () => {
  const k = known('Middle East Film & Comic Con (MEFCC) 2026', 'Abu Dhabi', 'United Arab Emirates');
  const o = { known: k, via: 'acronym', acronym: 'MEFCC', name: 'Middle East Film & Comic' };
  assert.equal(foreignInFilename(U('MEFCC AUH 2023 - Crowd Shot.jpg'), o), '');
  assert.equal(foreignInFilename(U('MEFCC AUH 2023 - Meet the Stars.jpg'), o), '');
  const kb = known('Busan International Film Festival (BIFF)', 'Busan', 'South Korea');
  const ob = { known: kb, via: 'acronym', acronym: 'BIFF', name: 'Busan International Film Festival' };
  assert.equal(foreignInFilename(U('Busan Cinema Center BIFF 2023.jpg'), ob), '');
});

// 역방향. 약어 검색이 물어왔다는 사실만으로는 아무것도 증명하지 못한다 —
// 파일명에 약어가 실제로 있어야 하고, 다른 영화제는 계속 막혀야 한다.
test('약어가 파일명에 없으면 계속 거부한다', () => {
  const k = known('Middle East Film & Comic Con (MEFCC) 2026', 'Abu Dhabi', 'United Arab Emirates');
  const o = { known: k, via: 'acronym', acronym: 'MEFCC', name: 'Middle East Film & Comic' };
  assert.notEqual(foreignInFilename(U('Rawdah Mohamed at some gala.jpg'), o), '');
  const kb = known('Busan International Film Festival (BIFF)', 'Busan', 'South Korea');
  const ob = { known: kb, via: 'acronym', acronym: 'BIFF', name: 'Busan International Film Festival' };
  assert.notEqual(foreignInFilename(U('Tokyo International Film Festival 2019.jpg'), ob), '');
});

// 약어가 파일명에 없어도, 행사 이름이 통째로 순서대로 들어 있으면 그 행사다.
// "IU for Broker open talk at Busan International Film Festival" 이 그것인데,
// 이름 네 단어가 전부 불용어·지명이라 신원 단어 규칙에 걸려 거부됐다. 네 단어
// 연속이면 그 자체로 충분히 특정된다 — 두 단어짜리(Asian Games)는 계속 규칙 적용.
test('약어 검색: 이름이 통째로 들어간 파일은 통과, 다른 도시 영화제는 거부', () => {
  const geo = geoTokens({ regions: ['Busan', 'Tokyo'], countries: ['South Korea', 'Japan'] });
  const kb = known('Busan International Film Festival (BIFF)', 'Busan', 'South Korea');
  const ob = { known: kb, via: 'acronym', acronym: 'BIFF', name: 'Busan International Film Festival', geo };
  assert.equal(foreignInFilename(U('IU for "Broker" open talk at Busan International Film Festival.jpg'), ob), '');
  // 같은 단어 세 개를 공유하지만 다른 영화제다. 지명 하나가 남으면 거부한다.
  assert.notEqual(foreignInFilename(U('Tokyo International Film Festival 2019.jpg'), ob), '');
});

// 짧은 이름의 형제 행사 방어는 그대로여야 한다(2026-08-22 에 세운 규칙).
test('네 단어 완화가 Para Asian Games 를 다시 열지 않는다', () => {
  const ka = known('Asian Games 2026', 'Nagoya', 'Japan');
  const geo = geoTokens({ regions: ['Nagoya', 'Hangzhou'], countries: ['Japan'] });
  assert.notEqual(foreignInFilename(U('3840px-Penutupan Para Asian Games 2018.jpg'), { known: ka, via: 'phrase', name: 'Asian Games', geo }), '');
});


// 2026-09-11 픽서님: 앵커 단어 문제도 고쳐라.
// 앵커는 제목에서 고른 단어 하나이고, 한 단어는 신원이 아니었다. 손으로 적은
// COMMON_ANCHOR 목록에 빠진 평범한 단어가 그대로 신원 대접을 받았다:
//   "quick" → 영국 포병대, "one" → 컨테이너선, "surprises" → 에미레이트 여객기.
// 이제 isCommonAnchor 가 우리 글에서 그 단어가 소문자로 쓰이는지를 보고 판단하고
// (scripts/build-common-words.mjs), 그것과 별개로 파일명의 나머지 단어가 다른
// 것을 가리키면 거부한다. 양방향 둘 다 이 파일이 지킨다.
test('앵커가 평범한 단어면 한 단어만으로 통과시키지 않는다', () => {
  const bad = [
    ['Quick Style India Tour 2026: What to Know (Chandigarh)', 'Chandigarh', 'India',
     'Shoeburyness Quick Fire Battery.jpg'],
    ['One Universe Festival 2026: What to Know (Incheon)', 'Incheon', 'South Korea',
     'Tollerort (COSCO Shipping Universe - One Recognition - Elbskipper).jpg'],
    ['Dubai Summer Surprises (DSS) 2026: What to Know (Dubai)', 'Dubai', 'United Arab Emirates',
     'A6-EMO B777-31H Emirates(Summer Surprises) MAN 15FEB03.jpg'],
    ['Grand Mint Festival 2026: Dates, Tickets & Venue (Seoul)', 'Seoul', 'South Korea',
     'Shillings of John II Casimir Vasa, minted in the Vilnius Mint in the middle of the 17th century.jpg'],
    ['Indonesia Comic Con 2026: Dates, Tickets & Venue (Tangerang)', 'Tangerang', 'Indonesia',
     'Cosplayers @ Comic Con Chile 2026.jpg'],
    ['World Athletics Continental Tour Silver Meet (Indian Open): What to Know (Bhubaneswar)', 'Bhubaneswar', 'India',
     'Nadezhda Dubovitskaya at 2022 Belgrade World Athletics Indoor Championships.jpg'],
    // 앵커가 이름이어도(ultra) 파일명 나머지가 통째로 다른 행사면 거부한다.
    ['Ultra Japan 2026: Dates, Tickets & Venue (Tokyo)', 'Tokyo', 'Japan',
     'Lokyii in Drive In Ultra LOVFINITY Vivienne Tam x Leon Lai Fashion Concert 20221218.jpg'],
  ];
  for (const [title, region, country, file] of bad) {
    assert.notEqual(actVerdict(title, region, country, file), '', `통과하면 안 됨: ${file}`);
  }
});

test('진짜 그 출연자·그 행사의 사진은 계속 통과한다', () => {
  const good = [
    ['The Weeknd – Hyundai Card Super Concert 28: Dates, Tickets & Venue (Goyang)', 'Goyang', 'South Korea',
     'The Weeknd at Bumbershoot 2015 (21367628469).jpg'],
    ['Evanescence Madrid 2026: Dates, Tickets & Venue (Madrid)', 'Madrid', 'Spain',
     'Evanescence at concert in San Petersburg.jpg'],
    ['Post Malone – BIG ASS World Tour: What to Know (Singapore)', 'Singapore', 'Singapore',
     'Post Malone at Rolling Loud 2019.jpg'],
    // 이름 전체가 순서대로 들어 있으면 앵커가 평범한 단어("miss")여도 그 행사다.
    ['Miss World 2026: Dates, Host Cities & Tickets (Vietnam)', 'Hanoi', 'Vietnam',
     'Camille Munro at Miss World 2013 Talent Competition.jpg'],
    ['Akbank Jazz Festival: Dates, Tickets & Venue (Istanbul)', 'Istanbul', 'Turkey',
     'Akbank Caz Festivali Kolaj.jpg'],
  ];
  for (const [title, region, country, file] of good) {
    assert.equal(actVerdict(title, region, country, file), '', `거부하면 안 됨: ${file}`);
  }
});
