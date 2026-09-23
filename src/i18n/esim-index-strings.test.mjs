// The eSIM index strings live in their own file (not ui.ts). A key missing in
// one language would leak English (or print "undefined") on that page, so every
// key must be present and non-empty in all five, with no {placeholder} left.
//
//   node --test src/i18n/esim-index-strings.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { ESIM_INDEX_KEYS, ESIM_INDEX_STRINGS } from './esim-index-strings.ts';

const LANGS = ['en', 'ko', 'ja', 'es', 'zh'];

test('all five languages are present', () => {
  assert.deepEqual(Object.keys(ESIM_INDEX_STRINGS).sort(), [...LANGS].sort());
});

test('every key exists, non-empty, in every language, and nothing extra', () => {
  for (const lang of LANGS) {
    const table = ESIM_INDEX_STRINGS[lang];
    for (const key of ESIM_INDEX_KEYS) {
      assert.equal(typeof table[key], 'string', `${lang}.${key} missing`);
      assert.ok(table[key].trim(), `${lang}.${key} empty`);
      assert.doesNotMatch(table[key], /\{[^}]*\}/, `${lang}.${key} has a placeholder`);
    }
    assert.deepEqual(Object.keys(table).sort(), [...ESIM_INDEX_KEYS].sort(), `${lang} has extra/missing keys`);
  }
});

test('localized strings are not copies of the English (except brand words)', () => {
  const same = new Set(['esimName', 'roamName']); // "eSIM" everywhere; es uses "Roaming"
  for (const lang of LANGS.filter((l) => l !== 'en')) {
    for (const key of ESIM_INDEX_KEYS) {
      if (same.has(key)) continue;
      assert.notEqual(ESIM_INDEX_STRINGS[lang][key], ESIM_INDEX_STRINGS.en[key], `${lang}.${key} is still English`);
    }
  }
});

test('house rule: no prices or figures in the chooser cards', () => {
  for (const lang of LANGS) {
    for (const [k, v] of Object.entries(ESIM_INDEX_STRINGS[lang])) {
      assert.doesNotMatch(v, /[$€£¥₩]|\bUSD\b|\bGB\b|%/, `${lang}.${k}`);
    }
  }
});
