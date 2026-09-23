// Every country that gets an eSIM page must sit in a region on the index, or it
// silently falls into the wrong group. Mirrors esimCountries() in esim-paths.mjs
// (active in countries.json AND has a facts entry) without importing JSON
// through the Astro-only path.
//
//   node --test src/lib/esim-regions.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ESIM_REGION_OF, ESIM_REGION_ORDER, carrierLine, groupByRegion } from './esim-regions.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const countries = read('../../data/countries.json').countries;
const facts = read('../../data/esim-facts.json');
const withPage = countries.filter((c) => c.active && facts[c.slug]).map((c) => c.slug);

test('there are eSIM pages to check (guards against an empty read passing blind)', () => {
  assert.ok(withPage.length >= 10, `only ${withPage.length} eSIM countries found`);
});

test('every country with an eSIM page has a region', () => {
  const missing = withPage.filter((s) => !ESIM_REGION_OF[s]);
  assert.deepEqual(missing, [], `add these to ESIM_REGION_OF in src/lib/esim-regions.mjs: ${missing.join(', ')}`);
});

test('every mapped region is a known region', () => {
  for (const [slug, r] of Object.entries(ESIM_REGION_OF)) assert.ok(ESIM_REGION_ORDER.includes(r), `${slug} → ${r}`);
});

test('grouping keeps every country exactly once', () => {
  const groups = groupByRegion(withPage.map((slug) => ({ slug })));
  const flat = groups.flatMap((g) => g.countries.map((c) => c.slug));
  assert.equal(flat.length, withPage.length);
  assert.deepEqual([...flat].sort(), [...withPage].sort());
});

test('an unmapped country is still linked, never dropped', () => {
  const groups = groupByRegion([{ slug: 'japan' }, { slug: 'atlantis' }]);
  assert.deepEqual(groups.flatMap((g) => g.countries.map((c) => c.slug)).sort(), ['atlantis', 'japan']);
});

test('carrierLine drops English asides but keeps brand parentheticals', () => {
  assert.equal(carrierLine(['AIS', 'True (merged with dtac)', 'NT']), 'AIS · True · NT');
  assert.equal(carrierLine(['NTT Docomo', 'au (KDDI)']), 'NTT Docomo · au (KDDI)');
  assert.equal(carrierLine(undefined), '');
});

test('no carrier line in the data carries a price or a number of GB', () => {
  for (const s of withPage) {
    const line = carrierLine(facts[s].carriers);
    assert.ok(line, `${s} has no carriers`);
    assert.doesNotMatch(line, /[$€£¥₩]|\bGB\b|\d+\s*(?:USD|EUR)/i, s);
  }
});
