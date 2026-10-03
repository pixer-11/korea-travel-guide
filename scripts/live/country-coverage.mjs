// Warning, not failure: does every country with an essentials guide have what
// the essentials hub shows beside it? (Codex D12, 2026-10-01.)
//  - a row in data/countries.json — without one the hub leaves the country out;
//  - mains voltage and plugs in data/country-plugs.json;
//  - a time zone in lib/countryTime.ts (or lib/venue-tz COUNTRY_TZ).
// A missing plug or time row only hides that one cell, and the nightly country
// relay must never be blocked by it (country-hub-data.test deliberately does
// not check coverage), so this prints "WARN" lines for the scheduled live run
// to pass on, and always exits 0.
// Run: node scripts/live/country-coverage.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COUNTRY_TZ } from '../../src/lib/venue-tz.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const countries = JSON.parse(read('data/countries.json')).countries;
const byName = new Map(countries.map((c) => [c.name, c]));
const plugs = JSON.parse(read('data/country-plugs.json')).countries;
// countryTime.ts is TypeScript; its keys are read, not imported.
const timeIso = new Set([...read('src/lib/countryTime.ts').matchAll(/^\s*([A-Z]{2}): \{ tz:/gm)].map((m) => m[1]));

const warns = [];
// Saw nothing is not "all present" (checker-must-not-pass-blind).
if (timeIso.size < 10) warns.push(`read only ${timeIso.size} time zones from lib/countryTime.ts — has its shape changed?`);
if (Object.keys(plugs).length < 10) warns.push(`read only ${Object.keys(plugs).length} rows from data/country-plugs.json`);
const dir = path.join(ROOT, 'src/content/essentials');
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(path.join(dir, f), 'utf8'))?.[1] ?? '';
  if (/^draft:\s*true/m.test(fm)) continue;
  const name = /^country:\s*"?([^"\r\n]+)"?/m.exec(fm)?.[1]?.trim();
  if (!name) { warns.push(`${f}: no country in frontmatter`); continue; }
  const c = byName.get(name);
  if (!c) { warns.push(`${name}: not in data/countries.json — the essentials hub leaves it out`); continue; }
  if (!plugs[name]) warns.push(`${name}: no voltage/plugs in data/country-plugs.json — the power cell is hidden`);
  if (!timeIso.has(String(c.iso2).toUpperCase()) && !COUNTRY_TZ[name]) warns.push(`${name}: no time zone in lib/countryTime.ts — the time cell is hidden`);
}
// Holiday names without a ko/ja/es/zh row print in English on those pages.
// holidays.test checks the same thing, but Tests does not run on the content
// commits that bring a new country's holidays in (Germany, 10-02), so it is
// repeated here, on the schedule (same rule as the test).
const holidayTable = JSON.parse(read('src/i18n/holidays.json'));
const facts = JSON.parse(read('data/country-facts.json'));
const untranslated = new Map();
for (const [country, v] of Object.entries(facts.countries ?? facts)) {
  for (const h of v.holidays ?? []) {
    if (h.localName === h.name) continue;
    const base = String(h.name).replace(/\s*\(Tentative Date\)\s*$/i, '');
    if (!holidayTable[`${country}|${base}`]) untranslated.set(country, new Set(untranslated.get(country)).add(base));
  }
}
for (const [country, names] of untranslated) warns.push(`${country}: ${names.size} holiday name(s) with no ko/ja/es/zh row — shown in English (node scripts/translate-holidays.mjs)`);
for (const w of warns) console.log(`WARN ${w}`);
console.log(warns.length ? `\n${warns.length} warning(s) — the pages work, a cell is missing` : 'every essentials country has its hub data');
