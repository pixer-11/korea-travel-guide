import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// fileURLToPath, not pathname.replace — a Windows-only path cost a CI run once.
const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(here, p), 'utf8'));

const TABLE = read('holidays.json');
const FACTS = read('../../data/country-facts.json');
const LANGS = ['ko', 'ja', 'zh', 'es'];

// Every holiday a page can print needs a row, or that page falls back to the
// local name alone — which is not wrong, but silently drops the gloss the
// reader needs. Adding a country (see the add-a-country procedure) pulls in a
// new holiday feed, and this is what tells us the table has to grow with it.
test('every holiday in the data has a translation row', () => {
  const countries = FACTS.countries ?? FACTS;
  const missing = new Set();
  for (const [country, v] of Object.entries(countries)) {
    for (const h of v.holidays ?? []) {
      if (h.localName === h.name) continue; // nothing to gloss
      const base = String(h.name).replace(/\s*\(Tentative Date\)\s*$/i, '');
      if (!TABLE[`${country}|${base}`]) missing.add(`${country}|${base}`);
    }
  }
  assert.deepEqual([...missing], [], `untranslated holidays: ${[...missing].join(', ')}`);
});

test('every row covers all four localized languages', () => {
  const gaps = [];
  for (const [key, row] of Object.entries(TABLE)) {
    for (const lang of LANGS) {
      if (!row[lang] || !String(row[lang]).trim()) gaps.push(`${key}/${lang}`);
    }
  }
  assert.deepEqual(gaps, [], `missing translations: ${gaps.join(', ')}`);
});

test('no row leaves English in a localized field', () => {
  // A translation that is byte-identical to the English key is a placeholder,
  // not a translation — except for proper nouns that genuinely stay Latin in
  // Spanish, which is why only the CJK languages are checked here.
  const leaks = [];
  for (const [key, row] of Object.entries(TABLE)) {
    const english = key.split('|')[1];
    for (const lang of ['ko', 'ja', 'zh']) {
      if (row[lang] === english) leaks.push(`${key}/${lang}`);
    }
  }
  assert.deepEqual(leaks, [], `untranslated (still English): ${leaks.join(', ')}`);
});

test('keys are country-qualified', () => {
  const bad = Object.keys(TABLE).filter((k) => !k.includes('|') || !k.split('|')[0].trim());
  assert.deepEqual(bad, []);
});
