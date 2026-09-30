// Every essentials-hub string exists, non-empty, in all five languages, with
// the same placeholders as English. A missing key falls back to English at
// runtime — the silent leak this test exists to catch.
//
//   node --test src/i18n/essentials-hub-strings.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The dictionary is TypeScript, and the test runs under plain `node --test`:
// the object literal itself is plain JavaScript, so it is cut out and evaluated.
const SRC = readFileSync(new URL('./essentials-hub-strings.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = SRC.indexOf('export const ESS_HUB_STRINGS = ') + 'export const ESS_HUB_STRINGS = '.length;
const end = SRC.indexOf('\n};\n', start) + 2;
const DICT = Function(`return (${SRC.slice(start, end)});`)();
const LANGS = ['en', 'ko', 'ja', 'es', 'zh'];
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('every key in all five languages, non-empty, same placeholders', () => {
  const keys = Object.keys(DICT.en);
  assert.ok(keys.length >= 40, `only ${keys.length} English keys parsed`);
  for (const lang of LANGS) {
    const b = DICT[lang];
    assert.ok(b, `no ${lang} block`);
    assert.deepEqual(Object.keys(b).sort(), [...keys].sort(), `${lang} key set differs from en`);
    for (const k of keys) {
      assert.ok(String(b[k]).trim(), `${lang}.${k} is empty`);
      assert.equal(placeholders(b[k]), placeholders(DICT.en[k]), `${lang}.${k} placeholders differ`);
    }
  }
});

test('localized blocks are not English copies', () => {
  for (const lang of ['ko', 'ja', 'zh']) {
    for (const k of Object.keys(DICT.en)) {
      if (DICT.en[k].length < 6) continue; // "{v} V · type {p}"-style shapes may coincide
      assert.notEqual(DICT[lang][k], DICT.en[k], `${lang}.${k} is untranslated`);
    }
  }
});
