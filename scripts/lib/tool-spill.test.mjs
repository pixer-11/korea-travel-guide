import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findToolSpill, missingFields } from './tool-spill.mjs';

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
