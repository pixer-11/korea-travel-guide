// The essentials page shows its cards only while data/essentials-facts.json
// was built from the CURRENT English guide (srcHash === bodyHash). When they
// drift, the page falls back to prose — correctly, but silently: a hand edit to
// one guide, or an add-essentials-section run, would take the cards off that
// country's five pages until next month's refresh, and nothing would say so
// (review, 2026-09-30). This test says so.
//
// Fix when it fails:  node scripts/build-essentials-facts.mjs --only=<slug>
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { bodyHash } from './lib/essentials-facts.mjs';

const SRC = fileURLToPath(new URL('../src/content/essentials/', import.meta.url));
const facts = JSON.parse(readFileSync(new URL('../data/essentials-facts.json', import.meta.url), 'utf8')).countries ?? {};

test('every published essentials guide has cards built from its current text', () => {
  const stale = [];
  for (const f of readdirSync(SRC).filter((x) => x.endsWith('.md'))) {
    const raw = readFileSync(SRC + f, 'utf8').replace(/\r\n/g, '\n');
    const end = raw.indexOf('\n---', 3);
    const fm = yaml.load(raw.slice(4, end));
    if (fm.draft) continue;
    const entry = facts[fm.country];
    // Same body the page hashes: Astro's entry.body is the markdown after the
    // frontmatter, and bodyHash trims and normalises line endings itself.
    const hash = bodyHash(raw.slice(end + 4));
    if (!entry) stale.push(`${f}: no cards built yet`);
    else if (entry.srcHash !== hash) stale.push(`${f}: guide changed since its cards were built`);
  }
  assert.deepEqual(stale, [], `rebuild with: node scripts/build-essentials-facts.mjs --only=${stale.map((s) => s.split('.md')[0]).join(',')}`);
});

test('every language entry is either vetted facts or an explicit null', () => {
  for (const [country, e] of Object.entries(facts)) {
    assert.ok(e.en && Array.isArray(e.en.summary), `${country}: no English facts`);
    for (const lang of ['ko', 'ja', 'es', 'zh']) {
      assert.ok(e[lang] === null || (e[lang] && Array.isArray(e[lang].summary)), `${country}/${lang}: missing (run with --retry-failed)`);
    }
  }
});
