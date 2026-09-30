// The essentials hub's power and time cells read two hand-kept tables:
// data/country-plugs.json and src/lib/countryTime.ts. A typo there would print
// a wrong plug letter or throw inside Intl on every visitor's page, so their
// SHAPE is checked here. Coverage is deliberately not: a country added by the
// nightly relay must not fail CI — it simply shows no power/time cell until
// its row is added (see the essentials-hub memory note).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const plugs = JSON.parse(readFileSync(new URL('../data/country-plugs.json', import.meta.url), 'utf8')).countries;
const countries = JSON.parse(readFileSync(new URL('../data/countries.json', import.meta.url), 'utf8')).countries;
const names = new Set(countries.map((c) => c.name));
const iso = new Set(countries.map((c) => String(c.iso2).toUpperCase()));

test('country-plugs.json: known countries, IEC letters, plausible volts and hertz, a source', () => {
  for (const [name, p] of Object.entries(plugs)) {
    assert.ok(names.has(name), `${name}: not a country in countries.json`);
    assert.ok(Array.isArray(p.plugs) && p.plugs.length, `${name}: no plugs`);
    for (const l of p.plugs) assert.match(l, /^[A-O]$/, `${name}: "${l}" is not an IEC plug letter`);
    assert.ok(Number(p.v) >= 100 && Number(p.v) <= 240, `${name}: voltage ${p.v}`);
    assert.match(p.hz, /^(50|60|50\/60)$/, `${name}: hertz ${p.hz}`);
    assert.match(p.src ?? '', /^https:\/\//, `${name}: no source`);
  }
});

test('countryTime.ts: real IANA zones, keys are country codes in countries.json', () => {
  const src = readFileSync(new URL('../src/lib/countryTime.ts', import.meta.url), 'utf8');
  const rows = [...src.matchAll(/^\s+([A-Z]{2}): \{ tz: '([^']+)', city: '([^']+)'/gm)];
  assert.ok(rows.length >= 20, `only ${rows.length} rows parsed`);
  for (const [, code, tz] of rows) {
    assert.ok(iso.has(code), `${code}: not an iso2 in countries.json`);
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: tz }), `${code}: bad time zone ${tz}`);
  }
});
