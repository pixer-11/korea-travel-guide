import test from 'node:test';
import assert from 'node:assert/strict';
import { topicKey } from './topic-key.mjs';

test('same-city name variants (year / filler) collapse to one key', () => {
  assert.equal(
    topicKey('ChinaJoy 2026: What to Know (Shanghai)', 'Shanghai'),
    topicKey('ChinaJoy: What to Know (Shanghai)', 'Shanghai'),
  );
});

test('same event with different word order collapses', () => {
  assert.equal(
    topicKey('Formula 1 Italian Grand Prix: What to Know', 'Monza'),
    topicKey('Italian Grand Prix Formula 1: What to Know', 'Monza'),
  );
});

test('different venues in the same city do NOT collapse', () => {
  assert.notEqual(
    topicKey('Saladaeng: Where to Eat', 'Bangkok'),
    topicKey('Somsak: Where to Eat', 'Bangkok'),
  );
});

test('same name in different cities does NOT collapse', () => {
  assert.notEqual(
    topicKey('The Tower: Travel Guide', 'Tokyo'),
    topicKey('The Tower: Travel Guide', 'Paris'),
  );
});

// The event suffix changed on 2026-08-07. If the two forms produced different
// keys, a re-discovered event would dodge the duplicate guard across the
// rename and get published twice.
test('old "What to Know" and new "Dates, Tickets & Venue" collapse to one key', () => {
  assert.equal(
    topicKey('Lollapalooza 2026: What to Know (Chicago)', 'Chicago'),
    topicKey('Lollapalooza 2026: Dates, Tickets & Venue (Chicago)', 'Chicago'),
  );
});

// 2026-08-12: the daily publish shipped "Old Town of Lijiang" and the bulk fill
// shipped "Lijiang Old Town" the same evening. Google files that place under two
// ids, so the place.id de-dupe saw two different venues — this key is the only
// thing that can tell they are one, and validate-content now consults it for
// posts WITH an id too, not just placeless ones.
test('word-order twins of the same landmark collapse to one key', () => {
  assert.equal(
    topicKey('Old Town of Lijiang: Travel Guide (4.6★)', 'Lijiang'),
    topicKey('Lijiang Old Town: Travel Guide (4.6★)', 'Lijiang'),
  );
});

// …but two genuinely different places in one city must stay apart, or the
// widened check would start deleting real guides.
test('different landmarks in the same city keep different keys', () => {
  assert.notEqual(
    topicKey('Black Dragon Pool: Travel Guide', 'Lijiang'),
    topicKey('Lijiang Old Town: Travel Guide', 'Lijiang'),
  );
});

// 2026-09-22: SAMAA_ in Sangenjaya was published twice, six days apart. The
// first copy shipped placeless, so the place.id de-dupe could not see it, and
// the topic key should have been the backstop — but Google returned the venue
// as "SAMAA_" one day and "Samaa (SAMAA_)" the next, and the alias spelling
// repeats the name. The old key sorted tokens WITHOUT collapsing repeats, so
// one title keyed "samaa tokyo tokyo travel" and the other
// "samaa samaa tokyo tokyo travel" — two keys for one cafe.
test('a name repeated by an alias parenthetical collapses to one key', () => {
  assert.equal(
    topicKey('SAMAA_: Tokyo Travel Guide', 'Tokyo'),
    topicKey('Samaa (SAMAA_): Tokyo Travel Guide', 'Tokyo'),
  );
});

// The same shape with the CITY repeated in the venue name — how the other two
// live twins this rule found were written ("Dubai Marina Walk" vs "Marina
// Walk: Dubai Marina", "El Campero" vs "El Campero Madrid").
test('a city name repeated inside the venue name collapses to one key', () => {
  assert.equal(
    topicKey('Dubai Marina Walk: Travel Guide (4.7★)', 'Dubai Marina'),
    topicKey('Marina Walk: Dubai Marina Travel Guide (4.7★)', 'Dubai Marina'),
  );
});

// …and collapsing repeats must not start merging different venues whose
// titles happen to share one word with the region.
test('repeat-collapsing keeps different venues in one city apart', () => {
  assert.notEqual(
    topicKey('Marina Bay Sands: Travel Guide', 'Marina Bay'),
    topicKey('Marina Bay Street Circuit: Travel Guide', 'Marina Bay'),
  );
});

// 2026-09-22: the same colonial house, written twice — once with its three
// tenant businesses spelled out in brackets. Eight bracketed tokens joined
// the sort and the two titles keyed nowhere near each other, so the draft sat
// one quarantine-release away from standing next to its own twin.
test('a parenthetical alias does not change the key', () => {
  assert.equal(
    topicKey('House of Tan Yeok Nee: Singapore Travel Guide', 'Singapore'),
    topicKey('House of Tan Yeok Nee (Loca Niru, Bar Kap & Jing Studio): Singapore Travel Guide', 'Singapore'),
  );
});

// The brackets are dropped, not treated as invisible: two venues that differ
// ONLY outside them stay apart, or a chain's branches would all be one post.
test('venues that differ outside the brackets stay apart', () => {
  assert.notEqual(
    topicKey('Blue Bottle Coffee (Shibuya): Tokyo Travel Guide', 'Tokyo'),
    topicKey('Fuglen Coffee (Shibuya): Tokyo Travel Guide', 'Tokyo'),
  );
});

// 2026-09-22, caught by the new quarantined-twin report on its first run: the
// key stripped every non-ASCII character, so a Vietnamese name came apart into
// fragments under three letters and NOTHING of it survived. What was left was
// the region — and two unrelated Da Nang restaurants, a kilometre and two
// Google place ids apart, keyed identically.
test('Vietnamese names survive as words, and different ones stay different', () => {
  const bep = topicKey('Bếp Cuốn Đà Nẵng: Where to Eat in Da Nang', 'Da Nang');
  const an = topicKey('Ăn Thôi: Where to Eat in Da Nang', 'Da Nang');
  assert.match(bep, /bep/);
  assert.notEqual(bep, an);
});

test('the same diacritic name spelled bare collapses to one key', () => {
  assert.equal(
    topicKey('Bếp Cuốn Đà Nẵng: Where to Eat in Da Nang', 'Da Nang'),
    topicKey('Bep Cuon Da Nang: Where to Eat in Da Nang', 'Da Nang'),
  );
});

// A name in a script this key cannot read leaves nothing behind. A key of just
// the region would mean "same city", which is not a duplicate — it is the
// whole city. Callers read an empty key as "cannot judge".
test('a name that leaves no readable word yields NO key', () => {
  assert.equal(topicKey('浅草寺: Where to Eat in Tokyo', 'Tokyo'), '');
  assert.equal(topicKey('서울숲: Where to Eat in Seoul', 'Seoul'), '');
});
