#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  CROWD PITCH STATS — the numbers a press answer or data pitch may quote.
//
//  Reads the public dataset we already publish (/api/crowd.json) and prints
//  only the claims that survive scrutiny, each with its denominator spelled
//  out. Used by the weekly `journalist-requests-weekly` task so the same
//  sentence is not re-derived by hand every week.
//
//  Usage:
//    node scripts/crowd-pitch-stats.mjs
//    node scripts/crowd-pitch-stats.mjs --file data/crowd.json
//    node scripts/crowd-pitch-stats.mjs --venue "Fushimi Inari Taisha" --venue "Kenroku-en"
//    node scripts/crowd-pitch-stats.mjs --json
//
//  It exits non-zero on an empty or unreadable dataset rather than printing a
//  confident "0 venues measured" — a press number with nothing behind it is
//  worse than no number.
// ─────────────────────────────────────────────────────────────
import fs from 'node:fs';
import { quotableStats, venue, cityRollup } from './lib/crowd-stats.mjs';

const API = 'https://wanderatlasguides.com/api/crowd.json';
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const all = (name) => argv.reduce((acc, a, i) => (a === name ? [...acc, argv[i + 1]] : acc), []);

const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const list = (hs) => (hs.length ? hs.map(hh).join(', ') : '—');
const pct = (x) => `${Math.round(x * 100)}%`;

async function load() {
  const file = flag('--file');
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = await fetch(API, { headers: { 'user-agent': 'wander-atlas-pitch-stats' } });
  if (!res.ok) throw new Error(`${API} → HTTP ${res.status}`);
  return res.json();
}

const doc = await load();
const places = Array.isArray(doc?.places) ? doc.places : [];
if (!places.length) {
  console.error('✗ no venues in the dataset — refusing to print statistics with nothing behind them.');
  process.exit(1);
}

const s = quotableStats(places);
const asked = all('--venue');
const venues = asked.map((n) => [n, venue(places, n)]);

if (argv.includes('--json')) {
  console.log(JSON.stringify({
    ...s,
    venues: Object.fromEntries(venues),
    cityRollup: cityRollup(places),
  }, null, 2));
  process.exit(0);
}

console.log(`\n📊 Crowd dataset — quotable figures  (${s.coverage.measuredFrom} → ${s.coverage.measuredTo})\n`);
console.log(`  ${s.coverage.venues} venues across ${s.coverage.countries} countries.`);
console.log(
  `  Of the ${s.morningQuiet.withQuietWeekdayHours} venues with reliably quiet weekday hours, ` +
  `${pct(s.morningQuiet.share)} (${s.morningQuiet.quietInMorning}) have one between ` +
  `${hh(s.morningQuiet.window[0])} and ${hh(s.morningQuiet.window[1])}.`,
);
console.log(
  `  The most common reliably-busy weekday hour is ${hh(s.peakBusyHour.hour)} ` +
  `(${s.peakBusyHour.venues} of the ${s.peakBusyHour.withBusyWeekdayHours} venues that have busy hours).`,
);

if (venues.length) {
  console.log('\n  Named venues (quote these, not averages):');
  for (const [asked_, v] of venues) {
    if (!v) { console.log(`    ✗ ${asked_} — not in the dataset`); continue; }
    console.log(`    ${v.name} · ${v.city}, ${v.country}  (measured ${v.measured})`);
    console.log(`        weekday  quiet ${list(v.weekdayQuiet)}   busy ${list(v.weekdayBusy)}`);
    console.log(`        weekend  quiet ${list(v.weekendQuiet)}   busy ${list(v.weekendBusy)}`);
  }
}

const roll = cityRollup(places);
console.log(`\n  ⚠ City averages are NOT quotable. ${roll.reason}`);
console.log('\n  Attribution required in any quote: "Crowd data measured by BestTime.app".');
if (doc.notice) console.log(`  Dataset notice: ${doc.notice}\n`);
