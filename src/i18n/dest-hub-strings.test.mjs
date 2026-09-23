// The country hub's redesign strings live in their own module (see the header of
// dest-hub-strings.ts). A key missing from one language would silently fall back
// to English on that language's 20 country pages, so every key must exist, be
// non-empty, and carry the same {placeholders} in all five.
//
//   node --test src/i18n/dest-hub-strings.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEST_HUB_STRINGS, destHubT } from './dest-hub-strings.ts';

const LANGS = ['en', 'ko', 'ja', 'es', 'zh'];
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('every dest-hub string exists in all five languages', () => {
  assert.deepEqual(Object.keys(DEST_HUB_STRINGS).sort(), [...LANGS].sort());
  const keys = Object.keys(DEST_HUB_STRINGS.en);
  assert.ok(keys.length > 0);
  for (const lang of LANGS) {
    const table = DEST_HUB_STRINGS[lang];
    assert.deepEqual(Object.keys(table).sort(), [...keys].sort(), `${lang} key set differs from en`);
    for (const key of keys) {
      assert.ok(String(table[key]).trim(), `${lang}.${key} is empty`);
      assert.deepEqual(placeholders(table[key]), placeholders(DEST_HUB_STRINGS.en[key]), `${lang}.${key} placeholders differ`);
    }
  }
});

test('the getter fills placeholders', () => {
  assert.equal(destHubT('ko')('h1', { country: '일본' }), '일본 여행 가이드');
  assert.equal(destHubT('es')('h1', { country: 'Japón' }), 'Guía de viaje de Japón');
  assert.equal(destHubT('zh')('h1', { country: '日本' }), '日本旅游指南');
  assert.equal(destHubT('ja')('h1', { country: '日本' }), '日本旅行ガイド');
});
