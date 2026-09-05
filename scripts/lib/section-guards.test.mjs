// section-guards 회귀 테스트.
//
// 09-05 Japan 사고 두 가지를 그대로 재현해서 잡는지 확인한다:
//  ① 발행된 파일에 실제로 새어 들어갔던 1인칭 독백 문장
//  ② 나리타 공항 페이지 두 장 + App Store 목록만 근거였는데 실린 "¥300–400"
//     (그 근거들은 그 숫자를 말하지 않는다)
//
//   node --test scripts/lib/section-guards.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { metaTextIn, unsupportedNumbers, currencyNumbersIn, commercialSources, proseProblems, unsupportedNames, stripLeadingMeta } from './section-guards.mjs';

test('metaTextIn catches the leak actually published in commit f48b2afd', () => {
  const leak =
    'I have enough verified information now to write the section.\n\n' +
    'Coin lockers are the default option...';
  const match = metaTextIn(leak);
  assert.ok(match, 'expected the leak sentence to be caught');
});

test('metaTextIn catches every phrase the review named', () => {
  const phrases = [
    'I have enough to go on now.',
    'I now have what I need.',
    'Let me check one more source.',
    "I'll write the section now.",
    'I will summarize the findings.',
    'Based on my search, coin lockers are common.',
    'Searching for more official sources.',
    'Now I can write the section.',
    'Here is the section on luggage storage.',
    'I found three official sources.',
  ];
  for (const p of phrases) {
    assert.ok(metaTextIn(p), `expected to catch: "${p}"`);
  }
});

test('metaTextIn returns null for a clean section', () => {
  const clean =
    'Coin lockers are the default option, found at nearly every JR and ' +
    'private-railway station. Sources:\n- [JR East](https://example.com/en/1)';
  assert.equal(metaTextIn(clean), null);
});

test('unsupportedNumbers reports the published "¥300–400" as unsupported ' +
     'against the two Narita airport pages actually cited (finding 1)', () => {
  const draft =
    'Coin lockers are found nationwide. Prices are typically ¥300–400 for small ' +
    'lockers, ¥400–500 for medium, and ¥500–800 for large per calendar day.\n\n' +
    'Sources:\n' +
    '- [Narita Airport – Baggage Storage](https://www.narita-airport.jp/en/service/delivery/storage/)\n' +
    '- [Narita Airport – Coin-Operated Lockers](https://www.narita-airport.jp/en/service/delivery/locker/)';
  // The Narita storage page has no numeric figures at all; the Narita locker
  // page states its own, airport-only daily rates (¥400/¥600/¥800) — not a
  // ¥300–400 range, not a ¥400–500 range, and not a ¥500–800 range.
  const naritaStoragePage = 'Charges vary by company. Please ask the company you intend to use.';
  const naritaLockerPage =
    'Coin-operated lockers at Narita Airport: ¥400 per use per day for a small ' +
    'locker, ¥600 per use per day for a medium locker, and ¥800 per use per day ' +
    'for a large locker.';
  const bad = unsupportedNumbers(draft, [naritaStoragePage, naritaLockerPage]);
  assert.ok(bad.includes('300'), `expected 300 to be reported unsupported, got: ${bad}`);
  assert.ok(bad.includes('500'), `expected 500 to be reported unsupported, got: ${bad}`);
});

test('unsupportedNumbers passes a number that does appear in a source text', () => {
  const draft = 'A small locker costs about ¥400 per day.';
  const source = 'Small lockers: ¥400 per use per day.';
  const bad = unsupportedNumbers(draft, [source]);
  assert.deepEqual(bad, []);
});

test('unsupportedNumbers ignores 2026 as a year, not a claimed figure', () => {
  const draft = 'This guide is current as of September 2026. A small locker costs ¥400.';
  const source = 'Small lockers: ¥400 per use per day.';
  const bad = unsupportedNumbers(draft, [source]);
  assert.ok(!bad.includes('2026'), `2026 should be ignored as a year, got: ${bad}`);
  assert.deepEqual(bad, []);
});

test('unsupportedNumbers ignores numbers embedded in a source URL', () => {
  const draft =
    'See the operator page for details.\n\nSources:\n' +
    '- [Operator page](https://example.com/en/service/12345/locker)';
  const bad = unsupportedNumbers(draft, ['Nothing relevant here.']);
  assert.ok(!bad.includes('12345'), `URL digits should be ignored, got: ${bad}`);
});

test('unsupportedNumbers normalizes thousands-separator commas both ways', () => {
  const draft = 'An extra-large locker costs ¥1,200 per day.';
  const source = 'Extra-large: 1200 yen per day.';
  const bad = unsupportedNumbers(draft, [source]);
  assert.deepEqual(bad, []);
});

// ── Round 2 (2026-09-05): currency-aware strict check ──────────────────
//
// The plain substring rule above collides constantly with postal codes,
// route numbers, phone numbers, visitor counts and dates. These tests use
// the independent reviewer's exact probe plus the brief's other cases.

test('unsupportedNumbers catches the reviewer\'s probe: a fabricated ¥550 ' +
     'price whose digits happen to appear elsewhere on an unrelated page', () => {
  const draft = 'A medium locker at this station costs about ¥550 per day.';
  const unrelatedSourcePage = `
    Contact us: Building 3, Room 12, 550-0001 Osaka-shi, Kita-ku.
    Bus route 550 departs every 20 minutes from the west exit.
    This terminal has served over 12,000,000 passengers since 1978.
    Nothing here mentions locker pricing at all.
  `;
  const bad = unsupportedNumbers(draft, [unrelatedSourcePage]);
  assert.ok(bad.includes('550'), `expected the fabricated ¥550 to be reported unsupported, got: ${bad}`);
});

test('unsupportedNumbers passes a currency figure stated near a marker in the source', () => {
  const draft = 'A small locker costs about ¥400 for a small locker.';
  const source = 'Small (S) ¥400 per use/day';
  const bad = unsupportedNumbers(draft, [source]);
  assert.deepEqual(bad, []);
});

test('unsupportedNumbers handles thousands separators and a range, including a full-width tilde', () => {
  const draft = '¥800–1,000 for the largest';
  const source = '800～1000JPY';
  const bad = unsupportedNumbers(draft, [source]);
  assert.deepEqual(bad, []);
});

test('unsupportedNumbers keeps the loose rule for a non-currency number that is stated', () => {
  const draft = 'Lockers are open 24 hours.';
  const source = '... 24 hour access to the locker room ...';
  const bad = unsupportedNumbers(draft, [source]);
  assert.deepEqual(bad, []);
});

test('unsupportedNumbers keeps the loose rule for a non-currency number that is NOT stated', () => {
  const draft = 'Lockers are open 26 hours.';
  const source = '... staff are on site around the clock ...';
  const bad = unsupportedNumbers(draft, [source]);
  assert.ok(bad.includes('26'), `expected 26 to be reported unsupported, got: ${bad}`);
});

test('currencyNumbersIn extracts a range yielding both ends, comma-normalized', () => {
  const nums = currencyNumbersIn('¥800–1,000 for the largest');
  assert.deepEqual(new Set(nums), new Set(['800', '1000']));
});

test('currencyNumbersIn extracts a marker-after figure ("12 THB")', () => {
  const nums = currencyNumbersIn('A locker costs 12 THB per day.');
  assert.deepEqual(nums, ['12']);
});

test('currencyNumbersIn does not treat an ordinary number as currency', () => {
  const nums = currencyNumbersIn('Lockers are open 24 hours.');
  assert.deepEqual(nums, []);
});

// ── Round 3 (2026-09-05): all 20 active-country currencies ─────────────
//
// currencyNumbersIn() previously missed ₫ (Vietnam), Rp (Indonesia), ₹
// (India) and UZS (Uzbekistan) entirely — those figures silently fell
// through to the loose substring rule, which is exactly the failure mode
// the strict rule exists to remove. This table covers one realistic price
// per active country.
const COUNTRY_CURRENCY_CASES = [
  ['United States', 'A locker costs $5 per day.', 'Lockers: $5 per day.', '5'],
  ['South Korea', 'A locker costs ₩5,000 per day.', 'Lockers: ₩5,000 per day.', '5000'],
  ['Japan', 'A small locker costs ¥400.', 'Small lockers: ¥400 per use.', '400'],
  ['China', 'A locker costs CNY 30 per day.', 'Lockers: CNY 30 per day.', '30'],
  ['Thailand', 'A locker costs 50 baht per day.', 'Lockers: 50 baht per day.', '50'],
  ['France', 'A locker costs €3 per day.', 'Lockers: €3 per day.', '3'],
  ['Spain', 'A locker costs €4 per day.', 'Lockers: €4 per day.', '4'],
  ['Italy', 'A locker costs €5 per day.', 'Lockers: €5 per day.', '5'],
  ['Singapore', 'A locker costs S$4 per day.', 'Lockers: S$4 per day.', '4'],
  ['Taiwan', 'A locker costs NT$50 per day.', 'Lockers: NT$50 per day.', '50'],
  ['Hong Kong', 'A locker costs HK$20 per day.', 'Lockers: HK$20 per day.', '20'],
  ['India', 'A locker costs ₹150 per day.', 'Lockers: ₹150 per day.', '150'],
  ['Turkey', 'A locker costs ₺150 per day.', 'Lockers: ₺150 per day.', '150'],
  ['Vietnam', 'A locker costs ₫50,000 per day.', 'Lockers: ₫50,000 per day.', '50000'],
  ['Indonesia', 'A locker costs Rp 25,000 per day.', 'Lockers: Rp 25,000 per day.', '25000'],
  ['United Arab Emirates', 'A locker costs 8 AED per day.', 'Lockers: 8 AED per day.', '8'],
  ['Malaysia', 'A locker costs RM 12 per day.', 'Lockers: RM 12 per day.', '12'],
  ['Philippines', 'A locker costs ₱100 per day.', 'Lockers: ₱100 per day.', '100'],
  ['Uzbekistan', 'A locker costs 12,000 som per day.', 'Lockers: 12,000 som per day.', '12000'],
  ['Cambodia', 'A locker costs 4,000 riel per day.', 'Lockers: 4,000 riel per day.', '4000'],
];

// The reviewer's postal-code/bus-route style page: full of digits, no
// currency marker anywhere, so the strict rule must reject every figure
// regardless of which country's marker was used in the draft.
function farSourceFor(digits) {
  return `Building 3, Room 12, ${digits}-0001 District. Bus route ${digits} ` +
    `departs every 20 minutes from the west exit. This terminal has served ` +
    `over ${digits}00000 passengers since 1978. Nothing here mentions pricing.`;
}

test('unsupportedNumbers passes a realistic price for every active country ' +
     'when the source states the figure near that country\'s marker', () => {
  for (const [country, draft, near] of COUNTRY_CURRENCY_CASES) {
    const bad = unsupportedNumbers(draft, [near]);
    assert.deepEqual(bad, [], `${country}: expected no unsupported numbers, got: ${bad}`);
  }
});

test('unsupportedNumbers flags the same 20 prices when the source does not ' +
     'state the figure near a currency marker (postal-code/bus-route page)', () => {
  for (const [country, draft, , digits] of COUNTRY_CURRENCY_CASES) {
    const bad = unsupportedNumbers(draft, [farSourceFor(digits)]);
    assert.ok(bad.includes(digits), `${country}: expected ${digits} to be reported unsupported, got: ${bad}`);
  }
});

test('currencyNumbersIn false-positive guards: "Rome" and "the RM went missing" ' +
     'yield no currency figures', () => {
  assert.deepEqual(currencyNumbersIn('Rome is lovely'), []);
  assert.deepEqual(currencyNumbersIn('the RM went missing'), []);
});

// ─── commercialSources / proseProblems ───────────────────────────────────
// Both were written after South Korea's first drafted section published a
// bag-drop vendor's sales copy — "273 stations with 5,557+ lockers",
// ₩3,999 a bag, "$3 USD" — with every earlier guard satisfied.

const KOREA_SLOP = `In Seoul, the T-Locker network covers 273 stations with 5,557+ lockers, booked
through its own app, with prices starting at 1,000 won for two hours. Stasher integrates its storage
services within GS25's strategically located branches, with 10+ luggage-storage points across Seoul.

At the airports, Incheon's lockers operate 24/7, providing travelers with round-the-clock storage
access, while counters are run by professional companies with excellent security. Expect rates from
about 4,000 KRW (about $3 USD) per day for small items.

Sources:
- [Incheon Airport](https://www.airport.kr/ap_en/6636/subview.do)
- [Stasher](https://stasher.com/luggage-storage/south-korea/seoul)`;

const JAPAN_GOOD = `Coin lockers are the default option, found at nearly every JR, subway and
private-railway station. JR East's own network, Multi Ecube, prices its lockers from about ¥300–400
for the smallest size up to ¥800–1,000 for the largest; Tokyo's tourism board quotes a similar range
of roughly ¥400–800, with an extra-large size around ¥1,200. Older machines take only ¥100 coins.

Airports run their own lockers and staffed counters: at Narita, coin lockers charge ¥400 for a small
bag, ¥600 for medium and ¥800 for large per day. Most hotels will hold bags before check-in.

Sources:
- [JR East](https://www.jre-sl.co.jp/en/ecube/)`;

test('commercialSources names the vendor link and leaves the airport authority alone', () => {
  const urls = [
    'https://www.airport.kr/ap_en/6636/subview.do',
    'https://stasher.com/luggage-storage/south-korea/seoul',
    'https://cloak.ecbo.io/en/jpn/city/tokyo/1',
  ];
  assert.deepEqual(commercialSources(urls), [
    'https://stasher.com/luggage-storage/south-korea/seoul',
    'https://cloak.ecbo.io/en/jpn/city/tokyo/1',
  ]);
});

test('commercialSources survives a malformed href', () => {
  assert.deepEqual(commercialSources(['not a url', '']), []);
});

test('proseProblems refuses the vendor-voice draft on every count that made it unpublishable', () => {
  const problems = proseProblems(KOREA_SLOP).join(' | ');
  assert.match(problems, /headline count "5,557\+"/);
  assert.match(problems, /headline count "10\+"/);
  assert.match(problems, /marketing phrase "excellent security"/);
  assert.match(problems, /marketing phrase "strategically located"/);
  assert.match(problems, /dollar conversion/);
});

test('proseProblems passes the reviewed Japan section — prices with commas are prices, not statistics', () => {
  assert.deepEqual(proseProblems(JAPAN_GOOD), []);
});

test('proseProblems counts only the body, and wants two paragraphs', () => {
  const oneParagraph = 'Lockers are everywhere.\n\nSources:\n- [x](https://example.gov)';
  assert.deepEqual(proseProblems(oneParagraph), ['1 paragraph(s), expected 2']);
});

test('proseProblems allows dollars for the United States', () => {
  const us = 'Amtrak charges $10 a bag.\n\nAirports have counters.\n\nSources:\n- [x](https://www.amtrak.com)';
  assert.deepEqual(proseProblems(us, { allowUsd: true }), []);
  assert.match(proseProblems(us).join(' '), /dollar conversion/);
});

test('unsupportedNames names the operators no source mentions, and lets the verified ones through', () => {
  const draft = `Bangkok BTS stations have coin lockers, such as LOCK BOX Bangkok and Blocker.
Networks such as Nannybag operate in Thai cities.

At the airports, Bellugg runs staffed counters at Suvarnabhumi.

Sources:
- [Suvarnabhumi](https://suvarnabhumi.airportthai.co.th/x)`;
  const source = 'Suvarnabhumi Airport BTS Bellugg left luggage counters Bangkok Thai baht per bag';
  assert.deepEqual(unsupportedNames(draft, [source]), ['LOCK BOX Bangkok', 'Blocker', 'Nannybag']);
});

test('unsupportedNames ignores a capitalised word that is only starting a sentence', () => {
  const draft = 'Lockers are common. Storage is cheap.\n\nHotels hold bags. Airports have counters.';
  assert.deepEqual(unsupportedNames(draft, ['nothing relevant here']), []);
});

test('unsupportedNames accepts a qualified name when the name itself is in the source', () => {
  const draft = 'a. JR East own network, Multi Ecube, prices its lockers.\n\nb. Nothing else.';
  assert.deepEqual(unsupportedNames(draft, ['JR East Ecube coin locker service']), []);
});

test('stripLeadingMeta removes the opening aside but leaves a mid-paragraph one to be refused', () => {
  const opener = 'I have enough information now to write this. Here it is:\n\nCoin lockers sit at every station.';
  assert.equal(stripLeadingMeta(opener), 'Coin lockers sit at every station.');
  const middle = 'Coin lockers sit at every station. Let me check the airport too.';
  assert.equal(stripLeadingMeta(middle), middle);
  assert.equal(metaTextIn(stripLeadingMeta(middle)), 'Let me');
});

test('stripLeadingMeta leaves a clean draft untouched', () => {
  const clean = 'Coin lockers are the default option. Fees are charged per calendar day.';
  assert.equal(stripLeadingMeta(clean), clean);
});

test('commercialSources also rejects someone else\'s write-up', () => {
  assert.deepEqual(
    commercialSources([
      'https://www.istairport.com/en/services/left-luggage',
      'https://www.sleepinginairports.net/guides/phnom-penh-airport-guide.htm',
      'https://www.reddit.com/r/JapanTravelTips/comments/x',
    ]),
    [
      'https://www.sleepinginairports.net/guides/phnom-penh-airport-guide.htm',
      'https://www.reddit.com/r/JapanTravelTips/comments/x',
    ],
  );
});

test('unsupportedNames does not invent "Miami International Airport of" by joining across a preposition', () => {
  const draft = 'a. Lockers sit at Miami International Airport of the sort found elsewhere.\n\nb. Nothing else.';
  assert.deepEqual(unsupportedNames(draft, ['Miami International Airport left luggage']), []);
});

test('proseProblems catches a section that is really one operator\'s brochure', () => {
  const brochure = `At Paris Charles de Gaulle, storage is offered by Bagages du Monde at Terminal 2.
Bagages du Monde also rents scooters and sells sightseeing tickets.

Bagages du Monde runs a similar counter at Orly, on the arrivals level.

Sources:
- [x](https://example.fr)`;
  assert.match(proseProblems(brochure).join(' | '), /"Bagages du Monde" named 3 times/);
});

test('proseProblems leaves a section that names two operators once each', () => {
  const fine = `JR East runs Multi Ecube lockers at most stations, and fees are charged per day.

At Narita Airport, coin lockers sit in both terminals and staffed counters take oversized bags.

Sources:
- [x](https://example.jp)`;
  assert.deepEqual(proseProblems(fine), []);
});

test('proseProblems: S$ is Singapore money, not a conversion; US$ is a conversion everywhere but the US', () => {
  const sgd = 'Lockers at Changi cost S$10 a day.\n\nHotels hold bags free.\n\nSources:\n- [x](https://changiairport.com)';
  assert.deepEqual(proseProblems(sgd, { dollarCurrency: true }), []);
  assert.match(proseProblems(sgd).join(' '), /dollar conversion/);
  const converted = 'Lockers cost S$10 (about US$8) a day.\n\nHotels hold bags free.\n\nSources:\n- [x](https://changiairport.com)';
  assert.match(proseProblems(converted, { dollarCurrency: true }).join(' '), /dollar conversion/);
});

test('metaTextIn catches the section talking about its own sourcing', () => {
  assert.ok(metaTextIn('Malls and hotels help, though none of these are covered by the source used here.'));
  assert.ok(metaTextIn('There is no equivalent detail available here for Milan Malpensa.'));
  assert.equal(metaTextIn('Lockers sit here, next to the ticket hall, and cost ¥400 a day.'), null);
});
