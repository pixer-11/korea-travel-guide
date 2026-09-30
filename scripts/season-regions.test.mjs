// data/season-regions.json stands on its guides' own words.
//
// The best-time grid splits a country into regions (Vietnam: north / central /
// south, owner 2026-10-01) from this file. Each country lists the sentences of
// its guide's "Best time to visit" section the months rest on; if a guide is
// rewritten and a sentence is gone, this fails, so the rows cannot outlive
// their source. Also checks the rows are well formed and every label exists
// in all five languages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DATA = JSON.parse(readFileSync(new URL('../data/season-regions.json', import.meta.url), 'utf8'));
const GUIDES = new URL('../src/content/essentials/', import.meta.url);
const guideOf = (country) => {
  for (const f of readdirSync(GUIDES).filter((x) => x.endsWith('.md'))) {
    const body = readFileSync(new URL(f, GUIDES), 'utf8');
    if (new RegExp(`^country:\\s*["']?${country}["']?\\s*$`, 'm').test(body)) return body;
  }
  return null;
};
const seasonSection = (body) => {
  const m = /^## Best time to visit\s*$([\s\S]*?)(?=^## )/m.exec(body);
  return m ? m[1].replace(/\s+/g, ' ') : '';
};

const countries = Object.keys(DATA).filter((k) => !k.startsWith('_'));

test('every region row rests on sentences still in its guide', () => {
  assert.ok(countries.length >= 1);
  for (const c of countries) {
    const body = guideOf(c);
    assert.ok(body, `${c}: no essentials guide`);
    const sec = seasonSection(body);
    assert.ok(sec, `${c}: guide has no "Best time to visit" section`);
    for (const q of DATA[c].quotes) assert.ok(sec.includes(q), `${c}: quote no longer in the guide: "${q}"`);
  }
});

test('region rows are well formed, in five languages', () => {
  for (const c of countries) {
    const regions = DATA[c].regions;
    assert.ok(regions.length >= 2, `${c}: a split needs two regions or more`);
    for (const r of regions) {
      for (const l of ['en', 'ko', 'ja', 'es', 'zh']) assert.ok(String(r.label?.[l] ?? '').trim(), `${c}.${r.key}: no ${l} label`);
      const best = r.best ?? [], avoid = r.avoid ?? [];
      for (const m of [...best, ...avoid]) assert.ok(Number.isInteger(m) && m >= 1 && m <= 12, `${c}.${r.key}: month ${m}`);
      assert.deepEqual(best.filter((m) => avoid.includes(m)), [], `${c}.${r.key}: a month both best and avoid`);
    }
  }
});
