import test from 'node:test';
import assert from 'node:assert/strict';
import { distinctiveTokens, pickVenueHit, venueQuery } from './photo-sources.mjs';

// ── 2026-08-23: 17 of 19 restored guides got "0 tried" because Foursquare
// was asked for Google's billboard name. The query is the head of the name;
// identity matching still sees the whole thing.
test('venueQuery keeps the part before a billboard separator or bracket', () => {
  assert.equal(venueQuery('Vandal Restaurant | Elevated Global Street Food', 'Lombok, Indonesia'), 'Vandal Restaurant');
  assert.equal(venueQuery('Yemeni Corner Restaurant (مطعم الركن اليمني)', 'Ajman, UAE'), 'Yemeni Corner Restaurant');
  // A head made only of generic words ("Vietnamese Food") would match any
  // Vietnamese restaurant — it is refused and the full name is sent instead.
  assert.equal(venueQuery('Vietnamese Food - Hue Local Food & FastFood 22 Restaurant (Huế)', 'Hue, Vietnam'), 'Vietnamese Food - Hue Local Food & FastFood 22 Restaurant (Huế)');
  assert.equal(venueQuery('The Island Bangkok – Top Rated Thai Restaurant & Bar', 'Bangkok, Thailand'), 'The Island Bangkok');
});

test('venueQuery falls back to the full name when the head has nothing distinctive, or there is no separator', () => {
  assert.equal(venueQuery('Restaurant - Mul Jil Korean BBQ', 'Kuala Lumpur, Malaysia'), 'Restaurant - Mul Jil Korean BBQ');
  assert.equal(venueQuery('Haesong Ssambap', 'Incheon, South Korea'), 'Haesong Ssambap');
  assert.equal(venueQuery('', 'x'), '');
});

// ── The 2026-08-07 quarantine incident, verbatim ─────────────────────────────
// "The Island Bangkok – Top Rated Thai Restaurant & Bar" (GSC rank 4.7, 304
// impressions) took the hero of "Baan Sabai Thai Massage" 71m away because
// 'thai' counted as a distinctive token. The massage shop must never match,
// and the venue's real (shorter) Foursquare name must still match.
const ISLAND = 'The Island Bangkok – Top Rated Thai Restaurant & Bar';
const BKK = 'Bangkok, Thailand';

test('nationality adjective alone cannot match a neighboring business', () => {
  const hit = pickVenueHit(ISLAND, BKK, [
    { name: 'Baan Sabai Thai Massage', distance: 71 },
  ]);
  assert.equal(hit, null);
});

test('the venue\'s short Foursquare registered name still matches', () => {
  const hit = pickVenueHit(ISLAND, BKK, [
    { name: 'Baan Sabai Thai Massage', distance: 71 },
    { name: 'The Island Restaurant (ก๋วยเตี๋ยว จุ่ม)', distance: 12 },
  ]);
  assert.equal(hit?.name, 'The Island Restaurant (ก๋วยเตี๋ยว จุ่ม)');
});

test('SEO descriptors (top/rated) prove nothing either', () => {
  const hit = pickVenueHit(ISLAND, BKK, [
    { name: 'Top Cafe Bangkok', distance: 40 },
  ]);
  assert.equal(hit, null);
});

// ── Guards that already existed must keep working (regressions) ──────────────
test('generic hospitality word alone still cannot match (NAM Kitchen case)', () => {
  const hit = pickVenueHit('NAM Kitchen', 'Ho Chi Minh City, Vietnam', [
    { name: 'Three Spice Thai Kitchen', distance: 20 },
  ]);
  assert.equal(hit, null);
});

test('category words alone still cannot match (Specialty Coffee case)', () => {
  const hit = pickVenueHit('Tonkin Specialty Coffee', 'Hanoi, Vietnam', [
    { name: 'Shin Specialty Coffee', distance: 15 },
  ]);
  assert.equal(hit, null);
});

test('a genuinely distinctive token still matches its venue', () => {
  const hit = pickVenueHit('Tonkin Specialty Coffee', 'Hanoi, Vietnam', [
    { name: 'Shin Specialty Coffee', distance: 15 },
    { name: 'Tonkin Coffee Roasters', distance: 30 },
  ]);
  assert.equal(hit?.name, 'Tonkin Coffee Roasters');
});

test('city tokens from `near` still cannot match (Chiangmai case)', () => {
  const hit = pickVenueHit('Garden to Table Chiangmai', 'Chiang Mai, Thailand', [
    { name: 'Chiang Mai Walking Street', distance: 90 },
  ]);
  assert.equal(hit, null);
});

test('hangul names still match space-insensitively (containment branch)', () => {
  // Google name carries the hangul in parentheses; FSQ registered the joined
  // hangul only. Containment + a shared distinctive token must accept it.
  const hit = pickVenueHit('Jumunjin Lighthouse (주문진등대)', 'Gangneung, South Korea', [
    { name: '주문진등대', distance: 25 },
  ]);
  assert.equal(hit?.name, '주문진등대');
});

test('live repro 2026-08-07: FSQ top result with thai+massage cannot steal the hit', () => {
  // Actual top-3 Foursquare returned for The Island's near-search — the old
  // matcher would have taken Wat Pho's massage school on 'thai'.
  const hit = pickVenueHit(ISLAND, BKK, [
    { name: 'Wat Pho Thai Traditional Medical and Massage School', distance: 900 },
    { name: 'May Kaidee Restaurant & Cooking School (หมายขายดี)', distance: 1100 },
    { name: 'Phra Nakorn Bar & Gallery (พระนครบาร์)', distance: 800 },
  ]);
  assert.equal(hit, null);
});

test('most shared distinctive tokens beats FSQ rank (Nami Island case)', () => {
  // Live repro 2026-08-07: with first-match, "Gamja Island" (1 shared token,
  // 'island') beat the real "Nami Island (남이섬)" (2 shared tokens) purely by
  // sorting first in FSQ results.
  const hit = pickVenueHit('Nami Island', 'Chuncheon, South Korea', [
    { name: 'Gamja Island (감자아일랜드)', distance: 40 },
    { name: 'Nami Island (남이섬)', distance: 300 },
  ]);
  assert.equal(hit?.name, 'Nami Island (남이섬)');
});

test('equal scores keep FSQ relevance order', () => {
  const hit = pickVenueHit('Tonkin Specialty Coffee', 'Hanoi, Vietnam', [
    { name: 'Tonkin Coffee Roasters', distance: 30 },
    { name: 'Tonkin Cafe', distance: 60 },
  ]);
  assert.equal(hit?.name, 'Tonkin Coffee Roasters');
});

// ── distinctiveTokens: the stopword list itself ──────────────────────────────
test('cuisine adjectives and business types are no longer distinctive', () => {
  assert.deepEqual(distinctiveTokens('Thai Restaurant Bangkok', BKK), []);
  assert.deepEqual(distinctiveTokens('Thai Massage & Spa Bangkok', BKK), []);
  assert.deepEqual(distinctiveTokens('Vietnamese Restaurant Hanoi', 'Hanoi, Vietnam'), []);
});

test('venues actually NAMED with a stopword keep their real distinctive token', () => {
  // "Ayasofya Turkish Restaurant" must still be matchable via 'ayasofya'.
  assert.deepEqual(
    distinctiveTokens('Ayasofya Turkish Restaurant', 'Kampong Glam, Singapore'),
    ['ayasofya'],
  );
  // The Island keeps 'island' once thai/top/rated are stopped.
  assert.deepEqual(distinctiveTokens(ISLAND, BKK), ['island']);
});

test('"Local Restaurant" stays matchable — local is deliberately NOT a stopword', () => {
  // Two published venues are literally named "Local Restaurant in <city>";
  // adding 'local' to the stopword list would refuse them (over-block, found
  // by corpus sweep 2026-08-07).
  assert.deepEqual(
    distinctiveTokens('Local Restaurant in Gangneung', 'Gangneung, South Korea'),
    ['local'],
  );
});

test('documented trade-off: a landmark named ONLY by a cuisine adjective refuses', () => {
  // "French Market" (New Orleans) loses its last token to the 'french'
  // stopword: FSQ/Flickr matching refuses (returns no photo) rather than risk
  // matching any nearby "French X". Commons covers landmarks like this.
  assert.deepEqual(
    distinctiveTokens('French Market', 'New Orleans, United States'),
    [],
  );
});

// ── 2026-11-13 장소 글 사진 전수 점검: 단어 하나만 겹쳐도 같은 가게로 받았다 ──
// 실제로 붙어 있던 사진들이다(포스퀘어 465장 중 13장). 겹친 단어는 전부 동네 이름이나
// 파는 음식이었고, 가게 이름의 첫 단어는 하나도 겹치지 않았다.
test('one shared word is a match only when our name leads with it', () => {
  const none = (name, near, theirs) => assert.equal(pickVenueHit(name, near, [{ name: theirs }]), null, `${name} ← ${theirs}`);
  none('Chipotle Gangnam', 'Seoul, South Korea', 'Gangnam Myeonok (강남면옥)');
  none('NUDAKE Tea House (Seongsu)', 'Seoul, South Korea', 'OSULLOC Tea House (오설록)');
  none('Chiikawa Ramen Buta', 'Tokyo, Japan', 'RAMEN TOMIRAI');
  none('Ignis Table', 'Shanghai, China', "Tai'an Table (泰安门)");
  none('NIJI Sushi Izakaya', 'Kuala Lumpur, Malaysia', 'Sushi ORI');
  none('Lina Anatolian Kitchen', 'Istanbul, Turkey', 'Sa Va Anatolian Breakfast House');
  none('Terracotta Osteria con Brace', 'Rome, Italy', 'Osteria Pesce Fritto e Baccalà');
  none('Panyu Lu Organ Rice Noodle Spot', 'Shanghai, China', 'Lao Di Fang Noodle House (老地方面馆)');
  // 첫 단어가 같아도, 상대 이름에 우리 이름에 없는 단어가 있으면 다른 가게다
  none('Atelier Kau Lou & Opia', 'Shanghai, China', 'Atelier By Taste Buds');
});

test('the lead-word rule keeps short forms, respellings and names inside ours', () => {
  const same = (name, near, theirs) => assert.equal(pickVenueHit(name, near, [{ name: theirs }])?.name, theirs, `${name} ← ${theirs}`);
  same('% Arabica Baitasi Store', 'Beijing, China', '% Arabica'); // 줄여 쓴 우리 이름
  same('Nobu (The Link, One Za\'abeel)', 'Dubai, United Arab Emirates', 'Nobu');
  same('Namsu (Namsu Shan Izakaya)', 'Bangkok, Thailand', 'Namsu Shan Cuisine & Sake Bar'); // 두 단어가 겹친다
  same("1932 (Raffles Grand Hotel d'Angkor)", 'Siem Reap, Cambodia', "Raffles Grand Hotel d'Angkor"); // 첫 단어 없이 여러 단어
  same('The Marble Mountains', 'Da Nang, Vietnam', 'Marble Mountain (Ngũ Hành Sơn)'); // 괄호 안은 현지어 표기
  same('Naritasan Shinsho-ji', 'Chiba, Japan', 'Naritasan Shinshoji Temple (成田山 新勝寺)'); // 붙여 쓴 표기 + 종류 단어
  same('Unabridged Bookstore', 'Chicago, United States', 'Unabridged Books');
  same('Araf', 'Istanbul, Turkey', 'Araf Coffee LAB'); // 이름이 한 단어면 예전 그대로
});

// 코덱스 지적 재현(11-13)
test('a translated kind word is not a rival name, but only for a one-word name', () => {
  assert.equal(pickVenueHit('Duden Waterfalls', 'Antalya, Turkey', [{ name: 'Düden Şelalesi' }])?.name, 'Düden Şelalesi');
  assert.equal(pickVenueHit('Alaaddin Hill Park', 'Konya, Turkey', [{ name: 'Alaaddin Tepesi' }])?.name, 'Alaaddin Tepesi');
  // 이름 단어가 둘이면 종류 단어 몫의 여유를 주지 않는다
  assert.equal(pickVenueHit('Wat Arun Temple', 'Bangkok, Thailand', [{ name: 'Wat Pho' }]), null);
});

test('a word repeated in our name counts once', () => {
  const name = 'Chola Cafe - Biryani House - “Best Biryani in Singapore”';
  assert.deepEqual(distinctiveTokens(name, 'Little India, Singapore'), ['chola', 'biryani']);
  assert.equal(pickVenueHit(name, 'Little India, Singapore', [{ name: 'Biryani Express' }]), null);
});

test('a one-word name must be the word their name leads with', () => {
  // NÔM(다이닝) 글에 닭밥집 "Cơm Gà Ta Quảng Nôm" 사진이 두 번 붙었다 — 우리 이름이 상대 이름의 끝 단어였다
  assert.equal(pickVenueHit('NÔM', 'Ho Chi Minh City, Vietnam', [{ name: 'Cơm Gà Ta Quảng Nôm' }]), null);
  assert.equal(pickVenueHit('Spago', 'Istanbul, Turkey', [{ name: 'Spago Istanbul by Wolfgang Puck' }])?.name, 'Spago Istanbul by Wolfgang Puck');
  assert.equal(pickVenueHit('Mabou', 'Istanbul, Turkey', [{ name: 'Restaurant Mabou' }])?.name, 'Restaurant Mabou');
  assert.equal(pickVenueHit('Maché', 'Madrid, Spain', [{ name: 'Restaurante Maché' }])?.name, 'Restaurante Maché');
  assert.equal(pickVenueHit('Kubaba in Paris', 'Paris, France', [{ name: 'Kubaba' }])?.name, 'Kubaba');
});

// 코덱스 2차 지적 재현(11-13)
test('a name written in two scripts leads with either one', () => {
  assert.equal(pickVenueHit('쿠라리에 (KURARIE)', 'Seoul, South Korea', [{ name: 'KURARIE Cafe' }])?.name, 'KURARIE Cafe');
  // 괄호 안이 같은 문자(지점·동네 이름)면 별칭이 아니다
  assert.equal(pickVenueHit('NUDAKE Tea House (Seongsu)', 'Seoul, South Korea', [{ name: 'Seongsu Cafe' }]), null);
});

test('an event name is not held to the place-name lead rules', () => {
  const hit = pickVenueHit('2026 Haddaway concert in Seoul', 'Seoul, South Korea', [{ name: 'Haddaway Live Hall' }], { event: true });
  assert.equal(hit?.name, 'Haddaway Live Hall');
  assert.equal(pickVenueHit('2026 Haddaway concert in Seoul', 'Seoul, South Korea', [{ name: 'Haddaway Live Hall' }]), null);
});
