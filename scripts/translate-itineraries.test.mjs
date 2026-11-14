import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  needsTranslation,
  stopSlugSet,
  stopWhyPairs,
  validateTranslationOutput,
  assembleI18nFrontmatter,
} from './translate-itineraries.mjs';

// ── needsTranslation (skip/stale decision) ──────────────────────────────────

test('needsTranslation: no existing translation -> translate', () => {
  assert.equal(needsTranslation(null, 'hash-a', false), true);
  assert.equal(needsTranslation(undefined, 'hash-a', false), true);
});

test('needsTranslation: same hash -> skip', () => {
  assert.equal(needsTranslation('hash-a', 'hash-a', false), false);
});

test('needsTranslation: different hash (stale) -> translate', () => {
  assert.equal(needsTranslation('hash-old', 'hash-new', false), true);
});

test('needsTranslation: --force -> always translate, even with a matching hash', () => {
  assert.equal(needsTranslation('hash-a', 'hash-a', true), true);
  assert.equal(needsTranslation(null, 'hash-a', true), true);
});

// ── stopSlugSet / stopWhyPairs (structural helpers) ─────────────────────────

test('stopSlugSet: flattens all stop slugs across days into one set', () => {
  const itinerary = [
    { stops: [{ slug: 'a' }, { slug: 'b' }] },
    { stops: [{ slug: 'b' }, { slug: 'c' }] },
  ];
  assert.deepEqual(stopSlugSet(itinerary), new Set(['a', 'b', 'c']));
});

test('stopSlugSet: empty/missing itinerary yields an empty set', () => {
  assert.deepEqual(stopSlugSet([]), new Set());
  assert.deepEqual(stopSlugSet(undefined), new Set());
});

test('stopWhyPairs: returns slug+why pairs in first-occurrence order', () => {
  const itinerary = [
    { stops: [{ slug: 'a', why: 'why a' }, { slug: 'b', why: 'why b' }] },
    { stops: [{ slug: 'c', why: 'why c' }] },
  ];
  assert.deepEqual(stopWhyPairs(itinerary), [
    { slug: 'a', why: 'why a' },
    { slug: 'b', why: 'why b' },
    { slug: 'c', why: 'why c' },
  ]);
});

test('stopWhyPairs: dedupes a repeated slug defensively, keeping the first', () => {
  const itinerary = [
    { stops: [{ slug: 'a', why: 'first' }] },
    { stops: [{ slug: 'a', why: 'second' }] },
  ];
  assert.deepEqual(stopWhyPairs(itinerary), [{ slug: 'a', why: 'first' }]);
});

// ── validateTranslationOutput (closed-world response validation) ───────────

const srcDays = [{ label: 'L', intro: 'I' }];
const stopSlugs = new Set(['a', 'b']);

test('validateTranslationOutput: passes for well-formed output', () => {
  const out = {
    title: 't', description: 'd', quickAnswer: 'q', faq: [{ q: 'Q?', a: 'A.' }],
    days: [{ label: 'L', intro: 'I' }],
    whys: { a: 'why a', b: 'why b' },
  };
  assert.doesNotThrow(() => validateTranslationOutput(out, srcDays, stopSlugs));
});

test('validateTranslationOutput: throws when day count mismatches the source', () => {
  const out = {
    title: 't', description: 'd', quickAnswer: 'q', faq: [],
    days: [{ label: 'L', intro: 'I' }, { label: 'L2', intro: 'I2' }],
    whys: { a: 'x', b: 'y' },
  };
  assert.throws(() => validateTranslationOutput(out, srcDays, stopSlugs), /day\(s\), expected 1/);
});

test('validateTranslationOutput: throws when whys is missing a source stop slug', () => {
  const out = {
    title: 't', description: 'd', quickAnswer: 'q', faq: [],
    days: [{ label: 'L', intro: 'I' }],
    whys: { a: 'only a' },
  };
  assert.throws(() => validateTranslationOutput(out, srcDays, stopSlugs), /missing why for stop slug "b"/);
});

test('validateTranslationOutput: throws when whys has a blank string for a slug', () => {
  const out = {
    title: 't', description: 'd', quickAnswer: 'q', faq: [],
    days: [{ label: 'L', intro: 'I' }],
    whys: { a: 'why a', b: '   ' },
  };
  assert.throws(() => validateTranslationOutput(out, srcDays, stopSlugs), /missing why for stop slug "b"/);
});

test('validateTranslationOutput: throws when whys references an unknown slug', () => {
  const out = {
    title: 't', description: 'd', quickAnswer: 'q', faq: [],
    days: [{ label: 'L', intro: 'I' }],
    whys: { a: 'why a', b: 'why b', 'not-a-real-slug': 'x' },
  };
  assert.throws(() => validateTranslationOutput(out, srcDays, stopSlugs), /unknown stop slug/);
});

test('validateTranslationOutput: throws when a day is missing label/intro', () => {
  const out = {
    title: 't', description: 'd', quickAnswer: 'q', faq: [],
    days: [{ label: 'L' }],
    whys: { a: 'why a', b: 'why b' },
  };
  assert.throws(() => validateTranslationOutput(out, srcDays, stopSlugs));
});

test('validateTranslationOutput: throws when title is missing', () => {
  const out = {
    title: '', description: 'd', quickAnswer: 'q', faq: [],
    days: [{ label: 'L', intro: 'I' }],
    whys: { a: 'why a', b: 'why b' },
  };
  assert.throws(() => validateTranslationOutput(out, srcDays, stopSlugs), /missing title/);
});

// ── assembleI18nFrontmatter (output shape) ──────────────────────────────────

test('assembleI18nFrontmatter: produces exactly the itinerariesI18n schema fields', () => {
  const out = {
    title: '제목', description: '설명', quickAnswer: '요약',
    faq: [{ q: 'Q?', a: 'A.' }],
    days: [{ label: '라벨', intro: '소개' }],
    whys: { a: '이유 a', b: '이유 b' },
  };
  const fm = assembleI18nFrontmatter({ lang: 'ko', slug: 'seoul-1-days', sourceHash: 'hash-1', out, stopSlugs: new Set(['a', 'b']) });

  assert.deepEqual(Object.keys(fm).sort(), [
    'days', 'description', 'faq', 'lang', 'quickAnswer', 'rainWhys', 'slug', 'sourceHash', 'title', 'whys',
  ].sort());
  assert.equal(fm.lang, 'ko');
  assert.equal(fm.slug, 'seoul-1-days');
  assert.equal(fm.sourceHash, 'hash-1');
  assert.equal(fm.title, '제목');
  assert.equal(fm.description, '설명');
  assert.equal(fm.quickAnswer, '요약');
  assert.deepEqual(fm.faq, [{ q: 'Q?', a: 'A.' }]);
  assert.deepEqual(fm.days, [{ label: '라벨', intro: '소개' }]);
  assert.deepEqual(fm.rainWhys, {}, 'rainWhys must always be an empty object — source has no rain prose');
});

test('assembleI18nFrontmatter: whys keys are exactly the union of stop slugs, regardless of what the model returned', () => {
  const stopSlugs = new Set(['a', 'b', 'c']);
  const out = {
    title: 't', description: 'd', quickAnswer: 'q', faq: [],
    days: [{ label: 'L', intro: 'I' }],
    // model returned an extra unrelated key and is missing "c" — assemble must
    // still key `whys` to exactly stopSlugs, never to out.whys's own keys.
    whys: { a: 'why a', b: 'why b', extraneous: 'should not appear' },
  };
  const fm = assembleI18nFrontmatter({ lang: 'ja', slug: 'tokyo-2-days', sourceHash: 'h', out, stopSlugs });

  assert.deepEqual(new Set(Object.keys(fm.whys)), stopSlugs);
  assert.equal(fm.whys.a, 'why a');
  assert.equal(fm.whys.b, 'why b');
  assert.equal(fm.whys.c, '', 'a slug the model omitted still gets a key, defaulted to empty string');
  assert.ok(!('extraneous' in fm.whys), 'a key the model invented that is not a real stop slug must be dropped');
});

test('assembleI18nFrontmatter: falls back description to title when missing, quickAnswer to empty string', () => {
  const out = { title: 't', days: [], faq: [], whys: {} };
  const fm = assembleI18nFrontmatter({ lang: 'es', slug: 's', sourceHash: 'h', out, stopSlugs: new Set() });
  assert.equal(fm.description, 't');
  assert.equal(fm.quickAnswer, '');
  assert.deepEqual(fm.whys, {});
});

// ── 영어 단어가 남은 번역(2026-11-14 ja/hiroshima-3-days 「…が best で…」) ──────────
// 감사(audit-latin-drops)는 쓰인 파일 전체를 읽는다. 이 도구의 관문도 같은 글자를 같은 함수로 본다.
test('a translation with an English word left in it is caught on the file as written', async () => {
  const yaml = (await import('js-yaml')).default;
  const { latinDrops } = await import('./lib/latin-drop.mjs');
  const stopSlugs = new Set(['hiroshima-peace-memorial-park']);
  const fileOf = (why) => {
    const fm = assembleI18nFrontmatter({
      lang: 'ja', slug: 'hiroshima-3-days', sourceHash: 'h',
      out: { title: '広島3日間', description: '広島の3日間モデルコース', quickAnswer: '', faq: [{ q: 'いつ行くのが良いですか?', a: why }], days: [{ label: '1日目', intro: '中区を歩きます。' }], whys: { 'hiroshima-peace-memorial-park': '平和記念公園から始めます。' } },
      stopSlugs,
    });
    return `---\n${yaml.dump(fm, { lineWidth: -1, noRefs: true, sortKeys: false })}---\n`;
  };
  assert.ok(latinDrops(fileOf('宮島は午前中が best で、午後は混み合います。'), 'ja').length > 0);
  assert.deepEqual(latinDrops(fileOf('宮島は午前中が最適で、午後は混み合います。'), 'ja'), []);
  // 스페인어 번역은 대상이 아니다
  assert.deepEqual(latinDrops(fileOf('La mañana es best para Miyajima.'), 'es'), []);
});
