import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findToolSpill, missingFields, completeToolInput } from './tool-spill.mjs';
import { readFileSync } from 'node:fs';

// 11-08: every reply for New Zealand, Peru and Argentina stopped at exactly
// 700 tokens with zh not yet written; 0 failed, 3 translated, nothing saved.
const tool = (input, stop_reason = 'tool_use') => ({ stop_reason, content: [{ type: 'tool_use', input }] });

test('completeToolInput returns a whole reply and refuses a cut, blank or spilled one', () => {
  const all = { ko: '가', ja: 'あ', es: 'a', zh: '一' };
  assert.deepEqual(completeToolInput(tool(all), ['ko', 'ja', 'es', 'zh']), all);
  assert.throws(() => completeToolInput(tool(all, 'max_tokens'), ['ko']), /max_tokens/);
  assert.throws(() => completeToolInput(tool({ ko: '가', ja: 'あ', es: 'a' }), ['ko', 'ja', 'es', 'zh']), /missing zh/);
  assert.throws(() => completeToolInput(tool({ ...all, zh: '  ' }), ['ko', 'ja', 'es', 'zh']), /missing zh/);
  assert.throws(() => completeToolInput({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'x' }] }, ['ko']), /no tool_use/);
});

test('the country blurb translator stores only a complete reply, and says when it could not', () => {
  const src = readFileSync(new URL('../translate-country-blurbs.mjs', import.meta.url), 'utf8');
  assert.match(src, /completeToolInput\(msg, LANGS\)/);
  assert.match(src, /process\.exitCode = 1/, 'publish.yml reports a soft failure only on a non-zero exit');
  assert.match(src, /fixPunctuation\(input\[l\]\)/, 'the Chinese blurb is born with full-width punctuation');
});

test('no country blurb carries half-width punctuation between Han characters', () => {
  const blurbs = JSON.parse(readFileSync(new URL('../../src/i18n/country-blurbs.json', import.meta.url), 'utf8'));
  const bad = Object.entries(blurbs).filter(([, v]) => /[一-鿿][,;:!?][一-鿿]/.test(v.zh ?? '')).map(([k]) => k);
  assert.deepEqual(bad, []);
});

// The real 2026-09-05 reply, trimmed: the model closed quickAnswer and opened
// the next parameter *inside* the quickAnswer string, so countryHeading never
// arrived and the built file broke the content collection.
const SPILLED = {
  metaTitle: '수하물 보관',
  quickAnswer:
    '거의 모든 여행에 적용되는 세 가지 선택지가 있습니다.</quickAnswer>\n<parameter name="countryHeading">국가별 수하물 보관 안내',
  breadcrumbName: '수하물 보관',
  body: '## 역의 코인 로커\n\n일본, 한국, 대만에서는…',
};

test('catches the tool-call spill that broke the 09-05 build', () => {
  assert.deepEqual(findToolSpill(SPILLED), ['quickAnswer']);
});

test('a clean reply has no hits', () => {
  assert.deepEqual(
    findToolSpill({
      metaTitle: 'Luggage storage',
      quickAnswer: 'Three options cover almost every trip.',
      countryHeading: 'Luggage storage, by country',
      body: '## Coin lockers\n\nIn Japan, Korea and Taiwan…',
    }),
    [],
  );
});

test('markdown that legitimately carries HTML is not a spill', () => {
  assert.deepEqual(
    findToolSpill({ body: 'See <a href="https://example.com">the page</a> and <strong>note</strong> this.' }),
    [],
  );
});

test('spill inside nested faq items is found by path', () => {
  const out = {
    faq: [
      { q: 'Can I leave bags at the station?', a: 'Yes, in most of East Asia.' },
      { q: 'What if lockers are full?', a: 'Try one stop away.</a>\n<invoke name="submit">' },
    ],
  };
  assert.deepEqual(findToolSpill(out), ['faq[1].a']);
});

test('a closing tag naming another field is a spill', () => {
  assert.deepEqual(findToolSpill({ h1: 'Title</dek>', dek: 'Sub' }), ['h1']);
});

test('non-object replies report every required field as missing', () => {
  assert.deepEqual(missingFields(undefined, ['h1', 'body']), ['h1', 'body']);
  assert.deepEqual(findToolSpill(undefined), []);
});

test('blank, whitespace and empty-array fields count as missing', () => {
  const out = { h1: 'Title', dek: '   ', faq: [], body: 'text' };
  assert.deepEqual(missingFields(out, ['h1', 'dek', 'faq', 'body', 'countryHeading']), [
    'dek',
    'faq',
    'countryHeading',
  ]);
});

test('the JSON form of a spill is caught; an ordinary quotation is not', () => {
  // 45 region intros, 2026-10-01: the whole reply landed in `blurb`.
  assert.deepEqual(findToolSpill({ blurb: 'Temple town.","getting":"Fly into SAI.', getting: 'Fly into SAI.', days: '3' }), ['blurb']);
  assert.deepEqual(findToolSpill({ blurb: '{"blurb": "x", "getting": "y"}', getting: 'y', days: 'z' }), ['blurb']);
  assert.deepEqual(findToolSpill({ blurb: 'Locals call it "the Loop", and so will you.', getting: 'ok', days: 'ok' }), []);
});
