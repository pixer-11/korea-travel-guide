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
import { metaTextIn, unsupportedNumbers } from './section-guards.mjs';

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
