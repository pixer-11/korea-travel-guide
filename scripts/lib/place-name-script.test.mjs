// node --test scripts/lib/place-name-script.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wrongScript } from './place-name-script.mjs';

test('catches a Cyrillic Chinese name (Canggu, 2026-10-05) and a missing language', () => {
  assert.deepEqual(wrongScript({ ko: '창구', ja: 'チャングー', es: 'Canggu', zh: 'створ' }), ['zh']);
  assert.deepEqual(wrongScript({ ko: '창구', ja: 'チャングー', es: 'Canggu' }), ['zh']);
  assert.deepEqual(wrongScript({ ko: 'チャングー', ja: '창구', es: '仓古', zh: 'チャングー' }), ['ko', 'ja', 'zh', 'es']);
});

test('accepts each language in its own script', () => {
  assert.deepEqual(wrongScript({ ko: '프랑크푸르트', ja: 'フランクフルト・アム・マイン', es: 'Fráncfort del Meno', zh: '美因河畔法兰克福' }), []);
});

test('every name already stored is in the right script', () => {
  const p = JSON.parse(readFileSync(new URL('../../src/i18n/places.json', import.meta.url), 'utf8'));
  const bad = Object.entries(p).filter(([, v]) => wrongScript(v).length).map(([k, v]) => `${k} ${wrongScript(v)} ${JSON.stringify(v)}`);
  assert.deepEqual(bad, []);
});
