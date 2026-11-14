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

// 2026-11-14 도쿄 5일 일정: 답이 "quickAnswer 없음"으로 두 번 거부됐는데, 문장은 description 끝에 다 들어 있었다
// (keys=days,title,description,whys,rainWhys,faq spill-in=description). 다시 묻지 않고 제자리로 돌려놓는다.
test('restoreSpilledFields: 앞 칸에 이어 쓴 다음 칸을 제자리로', async () => {
  const { restoreSpilledFields, findToolSpill } = await import('./tool-spill.mjs');
  const out = { title: 'T', description: 'Five days in Tokyo.</description>\n<parameter name="quickAnswer">Start in Asakusa, end in Odaiba.', days: [], whys: {}, faq: [] };
  assert.deepEqual(restoreSpilledFields(out, ['title', 'description', 'quickAnswer']), ['quickAnswer']);
  assert.equal(out.description, 'Five days in Tokyo.');
  assert.equal(out.quickAnswer, 'Start in Asakusa, end in Odaiba.');
  assert.deepEqual(findToolSpill(out), []);
  // 연달아 두 칸이 넘쳐도, 닫는 태그로 끝나도 된다
  const chain = { a: 'x</a>\n<parameter name="b">y</b>\n<parameter name="c">z</parameter>' };
  assert.deepEqual(restoreSpilledFields(chain), ['b', 'c']);
  assert.deepEqual(chain, { a: 'x', b: 'y', c: 'z' });
});

test('restoreSpilledFields: 확실하지 않으면 손대지 않는다', async () => {
  const { restoreSpilledFields } = await import('./tool-spill.mjs');
  // 이미 있는 칸은 덮어쓰지 않는다
  const taken = { description: 'x</description><parameter name="title">y', title: 'real' };
  assert.deepEqual(restoreSpilledFields(taken), []);
  assert.equal(taken.title, 'real');
  // 허용 목록 밖의 칸(배열·객체여야 하는 days)은 문자열로 만들어 넣지 않는다
  const wrongKind = { description: 'x</description><parameter name="days">y' };
  assert.deepEqual(restoreSpilledFields(wrongKind, ['quickAnswer']), []);
  // 자기 이름의 닫는 태그가 아니면 그 모양이 아니다
  const other = { description: 'x</title><parameter name="quickAnswer">y' };
  assert.deepEqual(restoreSpilledFields(other), []);
  // 넘친 쪽이 비어 있으면 복구가 아니다
  const empty = { description: 'x</description><parameter name="quickAnswer">  ' };
  assert.deepEqual(restoreSpilledFields(empty), []);
  assert.deepEqual(restoreSpilledFields(null), []);
});
