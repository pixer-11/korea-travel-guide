// Every ACTIVE country in data/countries.json — its name and every region —
// must have a ko/ja/es/zh entry in src/i18n/places.json.
//
// Why: the display-name dictionary is filled by build-place-names.mjs inside
// publish.yml, i.e. only when posts publish. A newly registered country ships
// its essentials/eSIM pages on the very next deploy, BEFORE any post exists —
// so ko/ja/es/zh readers saw "Uzbekistan 떠나기 전에 알아두기" for a day
// (2026-08-13, found by live audit). The prose-leak auditor can't catch it:
// a bare proper noun is not an English sentence. This test makes the gap a
// build-check failure instead of a live-site discovery: register a country →
// run `node scripts/build-place-names.mjs` in the same commit or CI goes red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => JSON.parse(readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8'));
const { countries } = read('../data/countries.json');
const places = read('../src/i18n/places.json');
const LANGS = ['ko', 'ja', 'es', 'zh'];

test('every active country and region has a localized display name', () => {
  const missing = [];
  for (const c of countries.filter((x) => x.active)) {
    for (const name of [c.name, ...(c.regions || [])]) {
      const entry = places[name];
      if (!entry) { missing.push(name); continue; }
      for (const l of LANGS) if (!entry[l] || !String(entry[l]).trim()) missing.push(`${name}(${l})`);
    }
  }
  assert.deepEqual(missing, [], `places.json is missing display names for: ${missing.join(', ')} — run \`node scripts/build-place-names.mjs\` and commit the result`);
});
