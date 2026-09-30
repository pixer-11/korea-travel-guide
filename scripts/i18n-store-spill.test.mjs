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
        // The web-search tool's citation markup (47 region intros, 10-01).
        if (typeof v === 'string' && /<\/?cite\b/i.test(v)) hits.push(`${f}: cite tag in …${v.slice(0, 60)}`);
      }
    }
  }
  assert.deepEqual(hits.slice(0, 10), [], `${hits.length} spilled value(s)`);
});

// A region intro's translation carries only the fields its English has. Where
// the English had no "days", translations said "미정", "<UNKNOWN>", a heading
// ("고양 가는 방법") or an invented "3~4일" (Bilbao) — 59 values, 2026-10-01.
test('regions.json: a translation has no field its English lacks', () => {
  const regions = JSON.parse(readFileSync(new URL('regions.json', DIR), 'utf8'));
  const extra = [];
  for (const [city, v] of Object.entries(regions)) {
    if (!v.en) continue; // hand-written cities keep their English elsewhere
    for (const k of ['blurb', 'getting', 'days']) {
      if (typeof v.en[k] === 'string' && v.en[k].trim()) continue;
      for (const l of ['ko', 'ja', 'es', 'zh']) if (v[l]?.[k]) extra.push(`${city}.${l}.${k}`);
    }
  }
  assert.deepEqual(extra.slice(0, 10), [], `${extra.length} translated field(s) with no English`);
});

// A translation is an intro, not a stub: Langkawi.es was
// {ko:'placeholder', ja:'placeholder', …}, Monza.es nested its intro one level
// down under "es", and Bacolod.zh said "describes here"
// in all three fields (2026-10-01).
test('regions.json: every language block is a real intro', () => {
  const regions = JSON.parse(readFileSync(new URL('regions.json', DIR), 'utf8'));
  const FIELDS = new Set(['blurb', 'getting', 'days', 'metaTitle', 'metaDesc']);
  const STUB = /^(placeholder|describes here|<?unknown>?|tbd|n\/a|미정|未定|待定|por (determinar|confirmar))$/i;
  const bad = [];
  for (const [city, v] of Object.entries(regions)) {
    for (const [l, o] of Object.entries(v)) {
      if (!o || typeof o !== 'object') { bad.push(`${city}.${l}: not an object`); continue; }
      for (const [k, s] of Object.entries(o)) {
        if (!FIELDS.has(k)) bad.push(`${city}.${l}.${k}: unknown field`);
        else if (typeof s !== 'string' || STUB.test(s.trim())) bad.push(`${city}.${l}.${k}: "${s}"`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} stub value(s)`);
});
