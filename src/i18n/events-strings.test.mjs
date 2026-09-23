// Every events-hub string exists, non-empty, in all five languages, with the
// same placeholders as English. A missing key falls back to English at runtime —
// which is exactly the silent leak this test exists to catch.
//
//   node --test src/i18n/events-strings.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Parsed from the source rather than imported: the dictionary is TypeScript,
// and the test must run under plain `node --test` in CI.
// CRLF-normalized: a Windows checkout (core.autocrlf) must parse the same.
const SRC = readFileSync(new URL('./events-strings.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const LANGS = ['en', 'ko', 'ja', 'es', 'zh'];

function block(lang) {
  const m = SRC.match(new RegExp(`\\n  ${lang}: \\{\\n([\\s\\S]*?)\\n  \\},`));
  assert.ok(m, `no ${lang} block`);
  return Object.fromEntries(
    [...m[1].matchAll(/^\s+(\w+): '((?:[^'\\]|\\.)*)',$/gm)].map((x) => [x[1], x[2]]),
  );
}

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('every key in all five languages, non-empty, same placeholders', () => {
  const en = block('en');
  const keys = Object.keys(en);
  assert.ok(keys.length >= 15, `only ${keys.length} English keys parsed`);
  for (const lang of LANGS) {
    const b = block(lang);
    assert.deepEqual(Object.keys(b).sort(), [...keys].sort(), `${lang} key set differs from en`);
    for (const k of keys) {
      assert.ok(b[k].trim(), `${lang}.${k} is empty`);
      assert.equal(placeholders(b[k]), placeholders(en[k]), `${lang}.${k} placeholders differ`);
    }
  }
});

test('localized blocks are not English copies', () => {
  const en = block('en');
  for (const lang of ['ko', 'ja', 'zh']) {
    const b = block(lang);
    for (const k of Object.keys(en)) assert.notEqual(b[k], en[k], `${lang}.${k} is untranslated`);
  }
});
