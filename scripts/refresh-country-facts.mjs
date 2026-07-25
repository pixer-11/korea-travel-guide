#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  COUNTRY FACTS — monthly climate + public holidays per country.
//  Free, keyless sources:
//   • Open-Meteo archive (last full year, aggregated to monthly hi/lo/rain)
//   • Nager.Date public holidays (this year + next; countries it doesn't
//     cover — e.g. Thailand/Taiwan/UAE — just get an empty list)
//  Coordinates need NO per-country config: the median lat/lng of a country's
//  own venue posts is its representative point, so "add country X" keeps
//  working with zero extra setup (posts appear → facts appear).
//  Output: data/country-facts.json, rendered on /essentials/<country>.
//  Usage: node scripts/refresh-country-facts.mjs   (monthly cron + manual)
// ─────────────────────────────────────────────────────────────
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'data', 'country-facts.json');

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function coordsByCountry() {
  const dir = join(ROOT, 'src', 'content', 'posts');
  const map = {};
  for (const f of (await readdir(dir)).filter((f) => f.endsWith('.md'))) {
    try {
      const { data } = matter(await readFile(join(dir, f), 'utf8'));
      const { country, place } = data;
      if (!country || typeof place?.lat !== 'number' || typeof place?.lng !== 'number') continue;
      (map[country] ??= { lats: [], lngs: [] });
      map[country].lats.push(place.lat);
      map[country].lngs.push(place.lng);
    } catch {}
  }
  return Object.fromEntries(
    Object.entries(map).map(([c, { lats, lngs }]) => [c, { lat: median(lats), lng: median(lngs) }]),
  );
}

async function climate(lat, lng) {
  const year = new Date().getUTCFullYear() - 1; // last complete year
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}` +
    `&start_date=${year}-01-01&end_date=${year}-12-31` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const { daily } = await res.json();
  const months = Array.from({ length: 12 }, () => ({ hi: [], lo: [], rain: 0 }));
  daily.time.forEach((d, i) => {
    const m = Number(d.slice(5, 7)) - 1;
    if (daily.temperature_2m_max[i] != null) months[m].hi.push(daily.temperature_2m_max[i]);
    if (daily.temperature_2m_min[i] != null) months[m].lo.push(daily.temperature_2m_min[i]);
    months[m].rain += daily.precipitation_sum[i] ?? 0;
  });
  const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  return months.map((m, i) => ({
    m: i + 1,
    hi: Math.round(avg(m.hi)),
    lo: Math.round(avg(m.lo)),
    rain: Math.round(m.rain),
  }));
}

async function holidays(iso2) {
  const y = new Date().getUTCFullYear();
  const all = [];
  for (const year of [y, y + 1]) {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${iso2.toUpperCase()}`);
    if (!res.ok) continue; // country not covered by Nager — fine
    const list = await res.json();
    if (!Array.isArray(list)) continue;
    for (const h of list) {
      if (!h.date || !(h.global ?? true)) continue; // nationwide only
      all.push({ date: h.date, localName: h.localName, name: h.name });
    }
  }
  // De-dupe (Nager sometimes repeats regional variants of the same day+name).
  const seen = new Set();
  return all.filter((h) => { const k = h.date + h.name; if (seen.has(k)) return false; seen.add(k); return true; });
}

async function main() {
  const { countries } = JSON.parse(await readFile(join(ROOT, 'data', 'countries.json'), 'utf8'));
  const coords = await coordsByCountry();
  const out = { updated: new Date().toISOString().slice(0, 10), countries: {} };

  for (const c of countries.filter((c) => c.active)) {
    const entry = {};
    const pt = coords[c.name];
    if (pt) {
      try { entry.climate = await climate(pt.lat, pt.lng); }
      catch (e) { console.log(`  ⚠️  ${c.name} climate: ${e.message}`); }
    } else {
      console.log(`  ·  ${c.name}: no post coordinates yet — climate skipped`);
    }
    try { entry.holidays = await holidays(c.iso2); }
    catch (e) { console.log(`  ⚠️  ${c.name} holidays: ${e.message}`); entry.holidays = []; }
    out.countries[c.name] = entry;
    console.log(`  ✅ ${c.name}: climate ${entry.climate ? '12mo' : '—'} · holidays ${entry.holidays?.length ?? 0}`);
  }

  await writeFile(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`\n📦 wrote data/country-facts.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
