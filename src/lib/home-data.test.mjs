// node --test src/lib/home-data.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { longWeekends, homeGroup, bandString, diverseNewest, roundRobinByCountry, countLastWeek } from './home-data.mjs';
import { HOME_STRINGS, homeT } from '../i18n/home-strings.ts';

const facts = JSON.parse(readFileSync(new URL('../../data/country-facts.json', import.meta.url), 'utf8'));
const KR = (facts.countries ?? facts)['South Korea'].holidays;

test('Korean long weekends from 2026-10-04 match the calendar', () => {
  const w = longWeekends(KR, { fromISO: '2026-10-04', limit: 10 });
  const pick = (s) => w.find((x) => x.start === s);
  // 개천절 (Sat) + Sunday + the Monday substitute: on now, three days.
  assert.deepEqual(pick('2026-10-03'), { start: '2026-10-03', end: '2026-10-05', days: 3, name: 'National Foundation Day', localName: '개천절' });
  // 한글날 on a Friday → Fri–Sun.
  assert.equal(pick('2026-10-09')?.days, 3);
  assert.equal(pick('2026-10-09')?.end, '2026-10-11');
  // Christmas on a Friday.
  assert.equal(pick('2026-12-25')?.days, 3);
  // 설 2027: Sat 6 – Tue 9, named after the holiday, not "the day preceding".
  const seol = pick('2027-02-06');
  assert.equal(seol?.days, 4);
  assert.equal(seol?.end, '2027-02-09');
  assert.equal(seol?.localName, '설날');
});

test('a lone weekday holiday is not a long weekend, and ended ones drop', () => {
  const w = longWeekends([{ date: '2026-07-15', name: 'X' }, { date: '2026-05-01', name: 'Y' }], { fromISO: '2026-06-01' });
  // 2026-07-15 is a Wednesday: one day off, not listed. 2026-05-01 (Fri) ended.
  assert.deepEqual(w, []);
});

test('groups split Asia the way the mock does', () => {
  assert.equal(homeGroup('Asia', 'jp'), 'east');
  assert.equal(homeGroup('Asia', 'HK'), 'east');
  assert.equal(homeGroup('Asia', 'th'), 'sea');
  assert.equal(homeGroup('Asia', 'in'), 'sea');
  assert.equal(homeGroup('Asia', 'tr'), 'meca');
  assert.equal(homeGroup('Europe', 'de'), 'europe');
  assert.equal(homeGroup('North America', 'mx'), 'amoc');
  assert.equal(homeGroup('Oceania', 'au'), 'amoc');
});

test('bands come from climate, and no record means no verdict', () => {
  const kr = bandString((facts.countries ?? facts)['South Korea'].climate);
  assert.equal(kr.length, 12);
  assert.match(kr, /^[gfah]{12}$/);
  assert.equal(bandString([]), '');
  assert.equal(bandString(undefined), '');
});

test('newest list keeps one per country', () => {
  const P = (id, country) => ({ id, data: { country } });
  const got = diverseNewest([P(1, 'Germany'), P(2, 'Germany'), P(3, 'Japan'), P(4, 'Germany'), P(5, 'Spain')], { n: 3 });
  assert.deepEqual(got.map((p) => p.id), [1, 3, 5]);
});

test('wall round-robin spreads countries', () => {
  const P = (id, country) => ({ id, data: { country } });
  const got = roundRobinByCountry([P(1, 'A'), P(2, 'A'), P(3, 'A'), P(4, 'B'), P(5, 'C')], 4);
  assert.deepEqual(got.map((p) => p.id), [1, 4, 5, 2]);
});

test('last-week count is inclusive of today and six days back', () => {
  const d = { a: '2026-10-04', b: '2026-09-28', c: '2026-09-27', d: '2026-10-05' };
  assert.equal(countLastWeek(d, '2026-10-04'), 2);
});

test('home strings exist in all five languages with the same placeholders', () => {
  const LANGS = ['en', 'ko', 'ja', 'es', 'zh'];
  const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(HOME_STRINGS).sort(), [...LANGS].sort());
  const keys = Object.keys(HOME_STRINGS.en);
  for (const lang of LANGS) {
    assert.deepEqual(Object.keys(HOME_STRINGS[lang]).sort(), [...keys].sort(), `${lang} key set differs`);
    for (const k of keys) {
      assert.ok(String(HOME_STRINGS[lang][k]).trim(), `${lang}.${k} empty`);
      assert.deepEqual(ph(HOME_STRINGS[lang][k]), ph(HOME_STRINGS.en[k]), `${lang}.${k} placeholders`);
    }
  }
  assert.equal(homeT('ko')('tag', { c: 24, n: 2160 }), '에디터가 검수한 해외여행 가이드 · 24개국 2160편');
});
