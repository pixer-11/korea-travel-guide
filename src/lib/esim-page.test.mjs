// node --test src/lib/esim-page.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recommend, CMP_MARKS, alertTipIndex, monthRuns } from './esim-page.mjs';
import { ESIM_PAGE_STRINGS, esimPageT } from '../i18n/esim-page-strings.ts';

test('the rule of thumb', () => {
  assert.equal(recommend({ people: 'solo', days: 5, prio: 'cost' }), 'esim');
  assert.equal(recommend({ people: 'group', days: 5, prio: 'cost' }), 'wifi');
  assert.equal(recommend({ people: 'small', days: 7, prio: 'share' }), 'wifi');
  assert.equal(recommend({ people: 'small', days: 7, prio: 'cost' }), 'esim');
  assert.equal(recommend({ people: 'solo', days: 3, prio: 'ease' }), 'roam');
  assert.equal(recommend({ people: 'solo', days: 4, prio: 'ease' }), 'esim');
  // A group outranks the short-trip rule: one device for everyone.
  assert.equal(recommend({ people: 'group', days: 2, prio: 'ease' }), 'wifi');
});

test('every option has a mark on every row', () => {
  for (const o of ['esim', 'wifi', 'roam']) {
    assert.deepEqual(Object.keys(CMP_MARKS[o]).sort(), ['Battery', 'Cost', 'Risk', 'Setup', 'Share']);
    for (const v of Object.values(CMP_MARKS[o])) assert.match(v, /^[gwb]$/);
  }
});

test('the alert card points at a real tip for every country we publish', () => {
  const facts = JSON.parse(readFileSync(new URL('../../data/esim-facts.json', import.meta.url), 'utf8'));
  for (const [slug, f] of Object.entries(facts)) {
    if (slug.startsWith('_')) continue;
    const i = alertTipIndex(slug, f.tips);
    assert.ok(i >= 0 && i < f.tips.length, `${slug}: ${i}`);
  }
  assert.equal(alertTipIndex('united-arab-emirates', ['a', 'b']), 0);
  assert.equal(alertTipIndex('india', ['a', 'b']), 0, 'an index past a shortened list falls back to the first tip');
  assert.equal(alertTipIndex('x', []), -1);
});

test('good months run across the new year', () => {
  assert.deepEqual(monthRuns([11, 12, 1, 2, 3]), [[11, 3]]);
  assert.deepEqual(monthRuns([4, 5, 10]), [[4, 5], [10, 10]]);
  assert.deepEqual(monthRuns([]), []);
  assert.deepEqual(monthRuns([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), [[1, 12]]);
});

test('page strings exist in all five languages with the same placeholders', () => {
  const LANGS = ['en', 'ko', 'ja', 'es', 'zh'];
  const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const keys = Object.keys(ESIM_PAGE_STRINGS.en);
  for (const lang of LANGS) {
    assert.deepEqual(Object.keys(ESIM_PAGE_STRINGS[lang]).sort(), [...keys].sort(), `${lang} key set differs`);
    for (const k of keys) {
      assert.ok(String(ESIM_PAGE_STRINGS[lang][k]).trim(), `${lang}.${k} empty`);
      assert.deepEqual(ph(ESIM_PAGE_STRINGS[lang][k]), ph(ESIM_PAGE_STRINGS.en[k]), `${lang}.${k} placeholders`);
    }
  }
  assert.equal(esimPageT('ko')('alertKicker', { country: '아랍에미리트' }), '아랍에미리트에서 꼭 알아둘 것');
});
