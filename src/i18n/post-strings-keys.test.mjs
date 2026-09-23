// The place-guide redesign keeps its strings in post-strings.ts (not ui.ts).
// A key missing from one language would silently fall back to English on a
// localized page, so: every language has exactly the English key set, no
// value is empty, localized values are not left in English, and every key the
// components ask for exists.
//
//   node --test src/i18n/post-strings-keys.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./post-strings.ts', import.meta.url), 'utf8');
const LANGS = ['en', 'ko', 'ja', 'es', 'zh'];

function block(lang) {
  const start = SRC.search(new RegExp(`^  ${lang}: \\{`, 'm'));
  assert.ok(start >= 0, `${lang} block missing`);
  const end = SRC.indexOf('\n  },', start);
  const body = SRC.slice(start, end);
  const out = new Map();
  for (const m of body.matchAll(/^\s+'(ps\.[\w.]+)':\s*(['"])(.*)\2,\s*$/gm)) out.set(m[1], m[3]);
  return out;
}

const blocks = Object.fromEntries(LANGS.map((l) => [l, block(l)]));

test('every language defines exactly the English keys, none empty', () => {
  const en = [...blocks.en.keys()].sort();
  assert.ok(en.length >= 15, `only ${en.length} English keys parsed`);
  for (const l of LANGS) {
    assert.deepEqual([...blocks[l].keys()].sort(), en, `${l} key set differs`);
    for (const [k, v] of blocks[l]) assert.ok(v.trim(), `${l} ${k} is empty`);
  }
});

test('placeholders survive translation', () => {
  for (const [k, v] of blocks.en) {
    const want = (v.match(/\{\w+\}/g) ?? []).sort();
    for (const l of LANGS) {
      assert.deepEqual((blocks[l].get(k).match(/\{\w+\}/g) ?? []).sort(), want, `${l} ${k} placeholders`);
    }
  }
});

test('CJK strings are not English left in place', () => {
  for (const l of ['ko', 'ja', 'zh']) {
    for (const [k, v] of blocks[l]) {
      assert.notEqual(v, blocks.en.get(k), `${l} ${k} is still English`);
      assert.match(v, /[぀-ヿ㐀-鿿가-힯]/, `${l} ${k} has no ${l} script`);
    }
  }
});

test('every ps() key used by the post components exists', () => {
  const files = [
    '../components/PostArticle.astro',
    '../components/post/CrowdBlock.astro',
    '../components/post/PostSidebar.astro',
  ];
  for (const f of files) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    for (const m of src.matchAll(/\bps\('([^']+)'\)/g)) {
      assert.ok(blocks.en.has(m[1]), `${f} uses unknown key ${m[1]}`);
    }
  }
});
