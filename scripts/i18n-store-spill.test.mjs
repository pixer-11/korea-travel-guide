// No model reply is stored half-parsed in the site's text stores.
//
// 2026-10-01: 45 region intros in src/i18n/regions.json held the model's whole
// JSON reply inside one field, and `","getting":"` printed mid-paragraph on
// /ko/regions/siem-reap and the rest. The generator now refuses such a reply
// (lib/tool-spill.mjs, JSON form); this test keeps every store under
// src/i18n clean, whichever script writes it next.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { findToolSpill } from './lib/tool-spill.mjs';

const DIR = new URL('../src/i18n/', import.meta.url);

function* objects(value) {
  if (Array.isArray(value)) for (const v of value) yield* objects(v);
  else if (value && typeof value === 'object') {
    yield value;
    for (const v of Object.values(value)) yield* objects(v);
  }
}

test('no src/i18n JSON store carries tool-call spill', () => {
  const hits = [];
  for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
    const data = JSON.parse(readFileSync(new URL(f, DIR), 'utf8'));
    for (const obj of objects(data)) {
      for (const p of findToolSpill(obj)) {
        const v = String(p.split('.').reduce((o, k) => o?.[k], obj) ?? '');
        hits.push(`${f}: …${v.slice(0, 60)}`);
      }
      // A whole reply stored as ONE string where an object belongs
      // (regions.json Chicago.zh held `{"blurb": "…", "getting": …}`).
      for (const v of Object.values(obj)) {
        if (typeof v === 'string' && /^\s*\{\s*"[A-Za-z_]+"\s*:/.test(v)) hits.push(`${f}: ${v.slice(0, 60)}`);
      }
    }
  }
  assert.deepEqual(hits.slice(0, 10), [], `${hits.length} spilled value(s)`);
});
