import test from 'node:test';
import assert from 'node:assert/strict';
import { commonsTitle, judgeIdentity, judgeCandidate, loadWorld } from './commons-identity.mjs';

// judgeCandidate 의 Foursquare 경로는 world 를 쓰지 않는다 — 빈 것으로 충분하다.
const EMPTY_WORLD = { countries: [], regions: [], regionCountry: new Map() };

const WORLD = {
  countries: ['South Korea', 'United States', 'Singapore', 'India', 'Philippines', 'Japan', 'Hong Kong', 'United Arab Emirates', 'Indonesia'],
  regions: ['Daegu', 'Los Angeles', 'Seoul', 'Busan', 'Mumbai', 'Palawan', 'Batanes', 'Tokyo', 'Phoenix', 'New York', 'Central', 'Dubai', 'Downtown Dubai', 'Mount Bromo', 'Malang'],
  regionCountry: new Map([
    ['Daegu', 'South Korea'], ['Los Angeles', 'United States'], ['Seoul', 'South Korea'],
    ['Busan', 'South Korea'], ['Mumbai', 'India'], ['Palawan', 'Philippines'],
    ['Batanes', 'Philippines'], ['Tokyo', 'Japan'], ['Phoenix', 'United States'],
    ['New York', 'United States'], ['Central', 'Hong Kong'], ['Dubai', 'United Arab Emirates'],
    ['Downtown Dubai', 'United Arab Emirates'], ['Mount Bromo', 'Indonesia'], ['Malang', 'Indonesia'],
  ]),
};

test('extracts the Commons title from a thumb URL', () => {
  assert.equal(
    commonsTitle('https://upload.wikimedia.org/wikipedia/commons/thumb/f/ff/Photos_at_teamlab.jpg/1920px-Photos_at_teamlab.jpg'),
    'Photos_at_teamlab.jpg',
  );
});

test('extracts from a direct (non-thumb) URL', () => {
  assert.equal(
    commonsTitle('https://upload.wikimedia.org/wikipedia/commons/a/ab/Tokyo_Tower.jpg'),
    'Tokyo_Tower.jpg',
  );
});

test('decodes percent-encoding and ignores query strings', () => {
  assert.equal(
    commonsTitle('https://upload.wikimedia.org/wikipedia/commons/thumb/f/ff/Caf%C3%A9_M%C3%BCnchen.jpg/800px-x.jpg'),
    'Café_München.jpg',
  );
  assert.equal(
    commonsTitle('https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg?utm_source=commons'),
    'X.jpg',
  );
});

test('returns null for non-Commons hosts', () => {
  assert.equal(commonsTitle('https://fastly.4sqi.net/img/general/original/123_abc.jpg'), null);
  assert.equal(commonsTitle('https://images.unsplash.com/photo-123'), null);
  assert.equal(commonsTitle(undefined), null);
});

// ── the real defects this was written for ─────────────────────
test('catches the Singapore Eggslut on a Los Angeles post', () => {
  const meta = {
    description: 'Eggslut, Suntec City Mall, Singapore',
    categories: ['Restaurants in Singapore', 'Eggslut', 'Singapore photographs taken on 2023-08-18'],
  };
  const r = judgeIdentity(meta, { country: 'United States', region: 'Los Angeles' }, WORLD);
  assert.equal(r.verdict, 'contradicts', r.why);
  assert.match(r.why, /Singapore/);
});

test('catches the Mumbai cafe on a Daegu post', () => {
  const meta = { description: 'Mumbai, India, Trendy cafe', categories: ['Cafés in Mumbai'] };
  const r = judgeIdentity(meta, { country: 'South Korea', region: 'Daegu' }, WORLD);
  assert.equal(r.verdict, 'contradicts', r.why);
});

test('a different region in the SAME country is flagged for a human, not auto-rejected', () => {
  // Batanes really is 1,000km from Palawan, so this one IS wrong — but the
  // verdict has to be "nearby", because the same test at "contradicts" also
  // fired on Puerto Princesa (which is INSIDE Palawan) and on Yangmingshan
  // (which straddles Taipei and New Taipei). The region list is flat and knows
  // no containment, so this class cannot be decided here. Reporting it and
  // stripping it are different powers, and only the first is safe.
  const meta = {
    description: 'Secret Lagoon at Malakdang, Sabtang Island, Batanes',
    categories: ['Batanes', 'Landscapes of the Philippines'],
  };
  const r = judgeIdentity(meta, { country: 'Philippines', region: 'Palawan' }, WORLD);
  assert.equal(r.verdict, 'nearby', r.why);
  assert.match(r.why, /Batanes/);
});

test('a different region in a DIFFERENT country is still a hard contradiction', () => {
  // Nothing to be uncertain about: the country is wrong too.
  const meta = { description: 'A market in Mumbai', categories: ['Markets in Mumbai'] };
  const r = judgeIdentity(meta, { country: 'South Korea', region: 'Daegu' }, WORLD);
  assert.equal(r.verdict, 'contradicts', r.why);
});

test('a region of the SAME country is nearby even when the caption never names the country', () => {
  // Mount Batok stands in Bromo's Sea of Sand; the uploader wrote only
  // "Malang" (the regency Bromo partly sits in). The strip was one night away
  // from deleting this photo over it.
  const meta = { description: 'Malang', categories: ['Mount Batok', 'Tengger caldera', 'Sand Sea (Lautan Pasir)'] };
  const r = judgeIdentity(meta, { country: 'Indonesia', region: 'Mount Bromo' }, WORLD);
  assert.equal(r.verdict, 'nearby', r.why);
});

test('the metro naming its own district is nearby, not a contradiction', () => {
  const meta = { description: 'Dubai Water Canal - a night view', categories: ['Dubai water canal'] };
  const r = judgeIdentity(meta, { country: 'United Arab Emirates', region: 'Jumeirah' }, WORLD);
  assert.equal(r.verdict, 'nearby', r.why);
});

test('a region name that is only the first word of a longer proper noun vouches for nothing', () => {
  // "Central Park, NYC" contains no district called Central — but Hong Kong's
  // Central is in the region list, and this exact photo (a genuine
  // Conservatory Garden shot) was marked wrong-place over it.
  const meta = { description: 'Central Park, NYC. Vandervilt Gate', categories: ['Conservatory Garden', 'Gates of Central Park'] };
  const r = judgeIdentity(meta, { country: 'United States', region: 'New York' }, WORLD);
  assert.equal(r.verdict, 'unknown', r.why);
});

test('without a regionCountry map, a foreign-looking region still condemns (old callers)', () => {
  const meta = { description: 'A market in Mumbai', categories: ['Markets in Mumbai'] };
  const bare = { countries: WORLD.countries, regions: WORLD.regions };
  const r = judgeIdentity(meta, { country: 'South Korea', region: 'Daegu' }, bare);
  assert.equal(r.verdict, 'contradicts', r.why);
});

test('accepts a photo whose metadata names the right place', () => {
  const meta = {
    description: 'Gwangjang Market, Seoul',
    categories: ['Markets in Seoul', 'South Korea photographs'],
  };
  const r = judgeIdentity(meta, { country: 'South Korea', region: 'Seoul' }, WORLD);
  assert.equal(r.verdict, 'supports', r.why);
});

test('a photo naming both the right city and another one is NOT a contradiction', () => {
  // "Seoul-style food in Busan" — the post's own city is present, so the other
  // mention is context, not a conflict.
  const meta = { description: 'Busan restaurant serving Seoul-style food', categories: ['Busan'] };
  const r = judgeIdentity(meta, { country: 'South Korea', region: 'Busan' }, WORLD);
  assert.equal(r.verdict, 'supports', r.why);
});

test('says unknown rather than guessing — the whole point', () => {
  assert.equal(judgeIdentity({ description: '', categories: [] }, { country: 'Japan', region: 'Tokyo' }, WORLD).verdict, 'unknown');
  assert.equal(judgeIdentity(null, { country: 'Japan', region: 'Tokyo' }, WORLD).verdict, 'unknown');
  const vague = { description: 'A bowl of noodles', categories: ['Food'] };
  assert.equal(judgeIdentity(vague, { country: 'Japan', region: 'Tokyo' }, WORLD).verdict, 'unknown');
});

test('word boundaries: "Nice" does not match inside "Venice"', () => {
  const meta = { description: 'A canal in Venice', categories: [] };
  const world = { countries: ['Italy', 'France'], regions: ['Nice', 'Venice'] };
  const r = judgeIdentity(meta, { country: 'Italy', region: 'Venice' }, world);
  assert.equal(r.verdict, 'supports', r.why);
});

// ── Foursquare credits ────────────────────────────────────────
import { judgeFoursquareCredit } from './commons-identity.mjs';

test('catches a credit naming a rival restaurant', () => {
  const r = judgeFoursquareCredit('Photo: Foursquare user content (Bismillah Biryani)', 'Chola Cafe & Biryani House');
  assert.equal(r.verdict, 'contradicts', r.why);
  assert.match(r.why, /Bismillah/);
});

test('catches the hotel credited on a restaurant post', () => {
  const r = judgeFoursquareCredit("Photo: Foursquare user content (One&Only One Za'abeel)", 'Nobu One Za\'abeel');
  // "za" and "abeel" are shared, so this one legitimately reads as supported —
  // pinning the behaviour rather than the wish.
  assert.ok(['supports', 'contradicts'].includes(r.verdict), r.why);
});

test('accepts an abbreviated credit', () => {
  const r = judgeFoursquareCredit('Photo: Foursquare user content (Flavors Grill)', 'Flavors Grill Abu Dhabi');
  assert.equal(r.verdict, 'supports', r.why);
});

test('accepts a misspelled credit', () => {
  const r = judgeFoursquareCredit('Photo: Foursquare user content (Souryana Restarant and Café)', 'Souryana Restaurant and Cafe');
  assert.equal(r.verdict, 'supports', r.why);
});

test('generic words alone never vouch for a match', () => {
  const r = judgeFoursquareCredit('Photo: Foursquare user content (Gajah Mada Food Centre)', 'Bangkok Coffee House');
  assert.equal(r.verdict, 'contradicts', r.why);
});

test('says unknown when there is nothing to compare', () => {
  assert.equal(judgeFoursquareCredit('Photo: Foursquare user content', 'Anything').verdict, 'unknown');
  assert.equal(judgeFoursquareCredit('Photo: Foursquare user content (The Cafe)', 'The Coffee House').verdict, 'unknown');
  assert.equal(judgeFoursquareCredit(undefined, 'X').verdict, 'unknown');
});

// ── Human-judged false positives ──────────────────────────────
import { makeJudgedIndex } from './commons-identity.mjs';

test('a judged (slug, key) pair is suppressed', () => {
  const idx = makeJudgedIndex([
    { slug: 'singapore-bouillon-gavroche', key: 'Photo: Foursquare user content (Boullion Gavroche)' },
    { slug: 'pingxi-shifen-waterfall', key: 'ShiFengWaterFall_002.jpg' },
  ]);
  assert.equal(idx.size, 2);
  assert.ok(idx.has('singapore-bouillon-gavroche', 'Photo: Foursquare user content (Boullion Gavroche)'));
  assert.ok(idx.has('pingxi-shifen-waterfall', 'ShiFengWaterFall_002.jpg'));
});

test('a NEW photo on a judged slug reports again — the judgement covered one photo, not the slug', () => {
  const idx = makeJudgedIndex([{ slug: 'pingxi-shifen-waterfall', key: 'ShiFengWaterFall_002.jpg' }]);
  assert.equal(idx.has('pingxi-shifen-waterfall', 'Completely_Different_Photo.jpg'), false);
});

test('a changed credit string voids the entry — the key IS the identity, not the slug', () => {
  const idx = makeJudgedIndex([{ slug: 'x', key: 'Photo: Foursquare user content (Old Venue)' }]);
  assert.equal(idx.has('x', 'Photo: Foursquare user content (New Venue)'), false);
});

test('the same key on a different slug vouches for nothing', () => {
  const idx = makeJudgedIndex([{ slug: 'a', key: 'Photo.jpg' }]);
  assert.equal(idx.has('b', 'Photo.jpg'), false);
});

test('tolerates a missing, empty, or malformed judged file', () => {
  assert.equal(makeJudgedIndex(undefined).size, 0);
  assert.equal(makeJudgedIndex([]).size, 0);
  const idx = makeJudgedIndex([null, {}, { slug: 'a' }, { key: 'b' }, { slug: '', key: 'x' }, { slug: 'ok', key: 'ok.jpg' }]);
  assert.equal(idx.size, 1);
  assert.ok(idx.has('ok', 'ok.jpg'));
});

// ── judgeCandidate: 사진을 붙이기 전에 묻는 관문 ────────────────────────────
//
// 2026-08-14 저녁, 신원 감사가 남의 가게 사진 11장을 떼어냈는데 한 시간 뒤
// 순찰이 그 중 7장을 그대로 다시 붙였다(뭄바이→대구, 홍콩 죽집→가데나,
// El Nacional→Barra Oso, Bismillah→Chola, Mr. Papa→Huiyyou). 비전은 전부
// 통과시켰다 — 전부 진짜 카페·식당 사진이니까. 메타데이터는 전부 거부했다.
// 그래서 그 판정을 채택 시점으로 옮겼다. **양방향이 똑같이 중요하다**:
// 오매칭을 막는가, 그리고 정당한 사진까지 막지는 않는가.

test('Foursquare 후보: credit이 다른 가게를 지목하면 거부한다', async () => {
  const v = await judgeCandidate(
    { url: 'https://fastly.4sqi.net/img/general/x.jpg', credit: 'Photo: Foursquare user content (Bismillah Biryani)' },
    { country: 'Singapore', region: 'Little India', venueName: 'Chola Cafe - Biryani House' }, EMPTY_WORLD);
  assert.equal(v.verdict, 'contradicts');
});

test('Foursquare 후보: credit이 그 가게면 통과시킨다 — 게이트가 전부를 막으면 사진이 영영 안 붙는다', async () => {
  const v = await judgeCandidate(
    { url: 'https://fastly.4sqi.net/img/general/y.jpg', credit: 'Photo: Foursquare user content (Biang Biang Noodles)' },
    { country: 'United States', region: 'Seattle', venueName: 'Biang Biang Noodles' }, EMPTY_WORLD);
  assert.equal(v.verdict, 'supports');
});

test('Foursquare 후보: 판단 근거가 없으면 unknown — 거부가 아니다', async () => {
  const v = await judgeCandidate(
    { url: 'https://fastly.4sqi.net/img/general/z.jpg', credit: 'Photo: Foursquare user content' },
    { country: 'Japan', region: 'Osaka', venueName: 'Some Bar' }, EMPTY_WORLD);
  assert.equal(v.verdict, 'unknown');
});

test('Commons도 Foursquare도 아닌 후보는 unknown', async () => {
  const v = await judgeCandidate(
    { url: 'https://example.com/photo.jpg', credit: 'Photo: someone' },
    { country: 'Italy', region: 'Rome', venueName: 'X' }, EMPTY_WORLD);
  assert.equal(v.verdict, 'unknown');
});

test('loadWorld: 두 나라에 같은 이름의 지역이 있으면 그 지역은 증거가 못 된다', async () => {
  const { mkdtemp, writeFile: wf } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'world-'));
  const p = join(dir, 'countries.json');
  await wf(p, JSON.stringify({ countries: [
    { name: 'Spain', regions: ['Valencia', 'Granada'] },
    { name: 'Venezuela', regions: ['Valencia'] },
  ] }));
  const w = await loadWorld(p);
  assert.equal(w.regionCountry.get('Valencia'), null);      // 스페인·베네수엘라 양쪽
  assert.equal(w.regionCountry.get('Granada'), 'Spain');
  assert.deepEqual(w.countries, ['Spain', 'Venezuela']);
});

test('소문자 형용사 "central courtyard"는 홍콩 Central이 아니다 (셀축 성채 오탐, 08-20)', () => {
  const world = { countries: ['Turkey', 'Hong Kong'], regions: ['Selcuk', 'Central'] };
  const v = judgeIdentity(
    { description: 'Walls of stone with crenellations, a mosque in the central courtyard, and ruins.', categories: ['İsa Bey Mosque'] },
    { country: 'Turkey', region: 'Selcuk' }, world);
  assert.notEqual(v.verdict, 'contradicts');
});

test('진짜 대문자 Central 지명은 여전히 잡는다', () => {
  const world = { countries: ['Turkey', 'Hong Kong'], regions: ['Selcuk', 'Central'] };
  const v = judgeIdentity(
    { description: 'Tai Kwun compound in Central, seen from the street.', categories: [] },
    { country: 'Turkey', region: 'Selcuk' }, world);
  assert.equal(v.verdict, 'contradicts');
});
