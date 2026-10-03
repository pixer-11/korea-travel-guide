// The home page's computed blocks (v3 redesign, 2026-10-04). Pure functions over
// data the caller passes in, so the arithmetic behind every number the home page
// prints can be tested outside an Astro build (home-data.test.mjs).
//
// The owner's mock-up shipped with example values — "41 places re-checked",
// a 23×12 month verdict table, flight times — and its own notes said they must
// come from real data. Each function below is that real source; anything the
// data cannot back (flight times, closure counts by day) is simply not shown.

import { monthComfort } from './when-to-go.mjs';
import { hubRegion } from './countryTime.ts';

const DAY = 86400000;
const utc = (s) => Date.parse(`${s}T00:00:00Z`);
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const isWeekend = (t) => { const d = new Date(t).getUTCDay(); return d === 0 || d === 6; };

// Names that only extend a holiday rather than name it ("Alternative holiday
// for …", "The day preceding Korean New Year") — the block is named after the
// real holiday inside it.
const FILLER = /alternative|observed|substitut|preceding|second day|day off|bridge/i;

/**
 * Runs of days off that contain at least one public holiday: the holiday dates
 * plus the weekends they touch. "Hangul Day on a Friday" is a three-day weekend
 * (Fri–Sun) because Saturday and Sunday are already off.
 *
 * Only for markets whose weekend is Saturday + Sunday with no make-up working
 * weekends — China swaps weekends for holiday days (调休), and this arithmetic
 * would invent days off there; the caller only passes Korea and Japan.
 *
 * @param {{date:string,name:string,localName?:string}[]} holidays
 * @param {{fromISO:string, minDays?:number, limit?:number}} opts
 * @returns {{start:string,end:string,days:number,name:string,localName:string}[]}
 */
export function longWeekends(holidays, { fromISO, minDays = 3, limit = 6 } = {}) {
  const byDay = new Map();
  for (const h of holidays ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h?.date ?? '')) continue;
    if (!byDay.has(h.date)) byDay.set(h.date, []);
    byDay.get(h.date).push(h);
  }
  const off = (t) => isWeekend(t) || byDay.has(iso(t));
  const seen = new Set();
  const out = [];
  for (const day of [...byDay.keys()].sort()) {
    if (seen.has(day)) continue;
    let s = utc(day);
    let e = s;
    while (off(s - DAY)) s -= DAY;
    while (off(e + DAY)) e += DAY;
    const hols = [];
    for (let t = s; t <= e; t += DAY) {
      seen.add(iso(t));
      hols.push(...(byDay.get(iso(t)) ?? []));
    }
    const days = Math.round((e - s) / DAY) + 1;
    if (days < minDays || iso(e) < fromISO) continue;
    const main = hols.find((h) => !FILLER.test(h.name)) ?? hols[0];
    out.push({ start: iso(s), end: iso(e), days, name: main.name, localName: main.localName || main.name });
  }
  return out.slice(0, limit);
}

// Asia is one hub region (countryTime.hubRegion); the home page splits it the way
// the mock-up does, into the near east and the south-east/south. Geography, not
// data: a new East Asian country is one code here, any other lands in 'sea'.
const EAST_ASIA = new Set(['KR', 'JP', 'CN', 'TW', 'HK', 'MO', 'MN', 'KP']);

/** 'east' | 'sea' | 'meca' | 'europe' | 'amoc' | 'africa' */
export function homeGroup(continent, iso2) {
  const code = String(iso2 ?? '').toUpperCase();
  const hub = hubRegion(continent, code);
  if (hub === 'asia') return EAST_ASIA.has(code) ? 'east' : 'sea';
  return hub;
}

export const GROUP_ORDER = ['east', 'sea', 'meca', 'europe', 'amoc', 'africa'];

/**
 * Twelve one-letter month bands for a country — g(ood) f(ine) a (fair) h(arsh) —
 * from when-to-go's monthComfort, or '' when the country has no full climate
 * record (the home page then leaves it out of the month picker: no invented
 * verdicts).
 */
export function bandString(climate) {
  const c = monthComfort(climate);
  if (!c) return '';
  const letter = { good: 'g', fine: 'f', fair: 'a', harsh: 'h' };
  return c.map((m) => letter[m.band] ?? 'a').join('');
}

/**
 * Newest first, at most `perCountry` from any one country. A bulk publish of
 * one country (25 German guides in a week) otherwise filled every "latest"
 * slot on the home page with Germany (live, 2026-10-04).
 */
export function diverseNewest(posts, { n = 6, perCountry = 1 } = {}) {
  const per = new Map();
  const out = [];
  for (const p of posts) {
    const c = p?.data?.country ?? 'South Korea';
    if ((per.get(c) ?? 0) >= perCountry) continue;
    per.set(c, (per.get(c) ?? 0) + 1);
    out.push(p);
    if (out.length >= n) break;
  }
  return out;
}

/**
 * Round-robin across countries, so the photo wall shows the world instead of
 * whichever country has the most posts. `order` is a shuffled list of posts;
 * the result keeps its order inside each country.
 */
export function roundRobinByCountry(order, n) {
  const queues = new Map();
  for (const p of order) {
    const c = p?.data?.country ?? 'South Korea';
    if (!queues.has(c)) queues.set(c, []);
    queues.get(c).push(p);
  }
  const lists = [...queues.values()];
  const out = [];
  for (let i = 0; out.length < n && lists.some((l) => l.length > i); i++) {
    for (const l of lists) {
      if (l[i]) out.push(l[i]);
      if (out.length >= n) break;
    }
  }
  return out;
}

/** How many entries of a {file: 'YYYY-MM-DD'} log fall in the 7 days ending `todayISO`. */
export function countLastWeek(dates, todayISO) {
  const from = iso(utc(todayISO) - 6 * DAY);
  return Object.values(dates ?? {}).filter((d) => typeof d === 'string' && d >= from && d <= todayISO).length;
}
