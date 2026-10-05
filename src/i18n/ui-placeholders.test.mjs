// Every UI string carries the same {placeholders} in every language.
// 2026-10-05: 'detour.dek' had {city} in ko/ja/zh but not in en/es, so all 68
// day-trip hubs shared one meta description in English and in Spanish. A key
// that drops a placeholder renders fine — it just says less, everywhere.
//   node --test src/i18n/ui-placeholders.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { ui } from './ui.ts';

// Grammar, not data: Korean picks 은/는 after the country name.
const EXTRA_OK = { ko: { 'post.editorTraveled': ['{eun}'] } };
const tokens = (s) => [...new Set(String(s).match(/\{[a-zA-Z]+\}/g) ?? [])].sort();

test('every key has the same {placeholders} as English in every language', () => {
  const bad = [];
  const en = ui.en;
  assert.ok(Object.keys(en).length > 300, 'ui.en looks empty');
  for (const [lang, dict] of Object.entries(ui)) {
    if (lang === 'en') continue;
    for (const [key, value] of Object.entries(dict)) {
      if (!(key in en)) continue;
      const extra = EXTRA_OK[lang]?.[key] ?? [];
      const mine = tokens(value).filter((t) => !extra.includes(t));
      if (mine.join() !== tokens(en[key]).join()) bad.push(`${lang} ${key}: ${mine.join('') || '-'} vs en ${tokens(en[key]).join('') || '-'}`);
    }
  }
  assert.deepEqual(bad, []);
});
