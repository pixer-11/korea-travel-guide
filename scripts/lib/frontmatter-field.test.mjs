import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setFrontmatterField, yamlQuote } from './frontmatter-field.mjs';

test('yamlQuote escapes apostrophes the YAML way', () => {
  assert.equal(yamlQuote("Pak Gula's menu"), "'Pak Gula''s menu'");
  assert.equal(yamlQuote('plain'), "'plain'");
});

test('replaces a one-line title and leaves every other line byte-identical', () => {
  const src = "---\ntitle: Pak Gula in Bali\ndescription: old\npubDate: '2026-07-01'\n---\nbody\n";
  const out = setFrontmatterField(src, 'title', 'Pak Gula, Uluwatu: Menu & Hours');
  assert.equal(out, "---\ntitle: 'Pak Gula, Uluwatu: Menu & Hours'\ndescription: old\npubDate: '2026-07-01'\n---\nbody\n");
});

test('replaces a folded multi-line description as a whole', () => {
  const src = '---\ntitle: x\ndescription: >-\n  first line of the old\n  description continues\ncountry: Italy\n---\nbody';
  const out = setFrontmatterField(src, 'description', 'New one-liner');
  assert.equal(out, "---\ntitle: x\ndescription: 'New one-liner'\ncountry: Italy\n---\nbody");
});

test('does not confuse a nested key or a prefix key with the top-level one', () => {
  const src = '---\nheroImage:\n  title: nested\ntitles: plural\ntitle: real\n---\n';
  const out = setFrontmatterField(src, 'title', 'changed');
  assert.equal(out, "---\nheroImage:\n  title: nested\ntitles: plural\ntitle: 'changed'\n---\n");
});

test('inserts when absent and keeps CRLF files CRLF', () => {
  const src = '---\r\ntitle: x\r\n---\r\nbody\r\n';
  const out = setFrontmatterField(src, 'description', 'added');
  assert.equal(out, "---\r\ndescription: 'added'\r\ntitle: x\r\n---\r\nbody\r\n");
});

test('refuses files without frontmatter', () => {
  assert.throws(() => setFrontmatterField('no frontmatter here', 'title', 'x'), /no frontmatter/);
});

// 2026-09-10: `setFrontmatterField(raw, 'draft', true)` wrote `draft: 'true'` —
// the STRING "true" — and the content schema rejected it, so the whole build
// died with InvalidContentEntryDataError on a post nobody had touched by hand.
// Quoting is right for strings (it is what keeps a 12-hex srcHash from being
// read as a float); it is wrong for the two types YAML writes bare.
test('불리언은 따옴표 없이 쓴다 — 스키마가 문자열 "true"를 거부한다', () => {
  const out = setFrontmatterField('---\ntitle: x\ndraft: false\n---\nbody\n', 'draft', true);
  assert.match(out, /^draft: true$/m);
  assert.doesNotMatch(out, /draft: 'true'/);
});

test('숫자도 따옴표 없이 쓴다', () => {
  const out = setFrontmatterField('---\ntitle: x\n---\nbody\n', 'rank', 7);
  assert.match(out, /^rank: 7$/m);
});

test('🛑 문자열은 그대로 따옴표를 유지한다 — srcHash 가 지수표기로 읽히면 안 된다', () => {
  const out = setFrontmatterField('---\ntitle: x\n---\nbody\n', 'srcHash', '818631094e44');
  assert.match(out, /^srcHash: '818631094e44'$/m);
});
