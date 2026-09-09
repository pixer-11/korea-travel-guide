#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  COUNTRY FACTS — monthly climate + public holidays per country.
//  Free, keyless sources:
//   • Open-Meteo archive (10 complete years, averaged to monthly hi/lo/rain,
//     sampled at the country's most-covered CITY — see coordsByCountry)
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

// Which point to sample for a country's climate.
//
// This used to take the median latitude and the median longitude INDEPENDENTLY,
// which lands on a coordinate that need not be near any venue — and usually was
// not. Vietnam resolved to the Annamite range on the Laos border and published a
// July high of 24C against Hanoi's 33C; the United States landed in rural
// Missouri, France in inland Provence rather than Paris, Turkey in Anatolia. All
// 1,020 when-to-go pages inherited whatever that phantom point reported.
//
// A traveller cares about the weather where they are going, so sample the city
// this site covers most — the one with the most published guides — at a real
// venue's coordinates, and record its name so the page can say which city the
// figures describe.
async function coordsByCountry() {
  const dir = join(ROOT, 'src', 'content', 'posts');
  const map = {};
  for (const f of (await readdir(dir)).filter((f) => f.endsWith('.md'))) {
    try {
      const { data } = matter(await readFile(join(dir, f), 'utf8'));
      if (data.draft) continue;
      const place = data.place;
      // 32 Korean posts carry no `country` field and were being skipped entirely,
      // so South Korea's climate came from barely half its venues.
      const country = data.country ?? 'South Korea';
      if (typeof place?.lat !== 'number' || typeof place?.lng !== 'number') continue;
      const region = data.region || country;
      (map[country] ??= new Map());
      const cur = map[country].get(region) ?? { n: 0, lat: place.lat, lng: place.lng };
      cur.n += 1;
      map[country].set(region, cur);
    } catch {}
  }
  return Object.fromEntries(
    Object.entries(map)
      .map(([country, regions]) => {
        const [city, pt] = [...regions.entries()]
          .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))[0];
        return [country, { lat: pt.lat, lng: pt.lng, city }];
      })
  );
}


// How many complete years get averaged. ONE year is weather, not climate — and
// the pages claimed "30-year averages" while showing a single year, so a wet
// October or one heatwave became "the wettest month of the year". Ten years
// buries an outlier and still fits a single archive request.
const CLIMATE_YEARS = 10;

// Source: NASA POWER, not Open-Meteo. Changed 2026-09-09 for a licensing reason,
// not a data one. Open-Meteo's free API is non-commercial only, and their own
// terms name "websites or apps that ... display advertisements" and "promotional
// activities" as commercial — this site carries affiliate links, so the free tier
// was never ours to use, however small our call volume (20 a month). Their
// historical archive needs the Professional plan, which is not a sensible bill for
// a site with no revenue. NASA POWER is a US government work: no commercial
// restriction, redistribution open, attribution requested and given on the page.
// Measured against the old figures for Barcelona before switching: highs within
// 1-2C, lows within 1C, rainfall within 10-20mm — different reanalysis models
// (MERRA-2 here, ERA5 there), same story for a traveller.
//
// POWER's *climatology* and *monthly* endpoints return the period's EXTREMES for
// T2M_MAX/T2M_MIN — Barcelona came out as a 22C January. What a traveller wants is
// the average daily high, so this reads DAILY values and averages them, exactly as
// the Open-Meteo version did.
const POWER_FILL = -999;
async function climate(lat, lng) {
  const last = new Date().getUTCFullYear() - 1; // last complete year
  const first = last - (CLIMATE_YEARS - 1);
  const url = 'https://power.larc.nasa.gov/api/temporal/daily/point'
    + `?parameters=T2M_MAX,T2M_MIN,PRECTOTCORR&community=AG&longitude=${lng}&latitude=${lat}`
    + `&start=${first}0101&end=${last}1231&format=JSON`;
  // Same retry shape as before: a rate-limited refresh must not lose a country.
  let res;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(url);
    if (res.ok) break;
    if (res.status !== 429 && res.status < 500) throw new Error(`nasa-power ${res.status}`);
    await new Promise((r) => setTimeout(r, 20000 * (attempt + 1)));
  }
  if (!res.ok) throw new Error(`nasa-power ${res.status} after retries`);
  const body = await res.json();
  const p = body?.properties?.parameter;
  if (!p?.T2M_MAX || !p?.T2M_MIN || !p?.PRECTOTCORR) throw new Error('nasa-power: no parameters in reply');
  const months = Array.from({ length: 12 }, () => ({ hi: [], lo: [], rain: 0 }));
  // Keys are YYYYMMDD. -999 is POWER's fill value; counting it as a temperature
  // would drag a month's average down by tens of degrees.
  for (const day of Object.keys(p.T2M_MAX)) {
    const m = Number(day.slice(4, 6)) - 1;
    if (!(m >= 0 && m < 12)) continue;
    const hi = p.T2M_MAX[day], lo = p.T2M_MIN[day], rain = p.PRECTOTCORR[day];
    if (hi > POWER_FILL) months[m].hi.push(hi);
    if (lo > POWER_FILL) months[m].lo.push(lo);
    if (rain > POWER_FILL) months[m].rain += rain;
  }
  // Rain summed across the whole window — divide back to a single year, or a
  // ten-year total gets published as one month's rainfall.
  for (const mo of months) mo.rain /= CLIMATE_YEARS;
  const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  return months.map((m, i) => ({
    m: i + 1,
    hi: Math.round(avg(m.hi)),
    lo: Math.round(avg(m.lo)),
    rain: Math.round(m.rain),
  }));
}

// Nager.Date covers most of Europe and the Americas but simply has no data for
// several countries this site publishes in — Thailand, the UAE, Taiwan, Malaysia
// and India all came back empty, which is why their essentials pages showed no
// holidays at all. Google's public holiday calendars cover them and are free, so
// they serve as the fallback. Two id shapes are in use (en.th, but taiwan /
// malaysia / indian), hence the candidate list.
// Google uses two id shapes and which one a country answers to is not guessable:
// some are <lang>.<iso2> (en.th), others <lang>.<name> (tw.taiwan, ms.malaysia,
// en.indian). Each country lists the forms that were verified to return events.
const GCAL_IDS = {
  th: ['en.th'], ae: ['en.ae'], tw: ['tw.taiwan', 'en.tw'],
  my: ['ms.malaysia', 'en.my'], in: ['en.indian', 'en.in'],
};

/** Minimal ICS reader: all-day VEVENTs are DTSTART;VALUE=DATE:YYYYMMDD + SUMMARY. */
function parseIcs(text, years) {
  const out = [];
  for (const block of text.split('BEGIN:VEVENT').slice(1)) {
    const date = block.match(/DTSTART[^:\r\n]*:(\d{8})/)?.[1];
    const name = block.match(/SUMMARY:(.+)/)?.[1]?.trim();
    if (!date || !name) continue;
    const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    if (!years.includes(Number(date.slice(0, 4)))) continue;
    out.push({ date: iso, localName: name, name });
  }
  return out;
}

async function gcalHolidays(iso2, years) {
  for (const id of GCAL_IDS[iso2.toLowerCase()] ?? []) {
    try {
      const url = `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}%23holiday%40group.v.calendar.google.com/public/basic.ics`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const hits = parseIcs(await res.text(), years);
      if (hits.length) return hits;
    } catch { /* try the next id */ }
  }
  return [];
}

async function holidays(iso2) {
  const y = new Date().getUTCFullYear();
  const years = [y, y + 1];
  const all = [];
  for (const year of years) {
    try {
      const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${iso2.toUpperCase()}`);
      if (!res.ok) continue; // country not covered by Nager — the fallback handles it
      const list = await res.json();
      if (!Array.isArray(list)) continue;
      for (const h of list) {
        if (!h.date || !(h.global ?? true)) continue; // nationwide only
        all.push({ date: h.date, localName: h.localName, name: h.name });
      }
    } catch { /* not covered, or a bad body — fall through */ }
  }
  if (!all.length) all.push(...(await gcalHolidays(iso2, years)));
  // De-dupe (Nager sometimes repeats regional variants of the same day+name).
  const seen = new Set();
  return all
    .filter((h) => { const k = h.date + h.name; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function main() {
  const { countries } = JSON.parse(await readFile(join(ROOT, 'data', 'countries.json'), 'utf8'));
  // Keep what is already known. A rate-limited run used to write an empty file
  // over good data: 17 countries lost their climate in one pass because the API
  // answered 429. A refresh that cannot fetch should change nothing.
  let prev = { countries: {} };
  try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
  const coords = await coordsByCountry();
  const out = { updated: new Date().toISOString().slice(0, 10), countries: {} };

  for (const c of countries.filter((c) => c.active)) {
    const entry = {};
    const pt = coords[c.name];
    if (pt) {
      try {
        entry.climate = await climate(pt.lat, pt.lng);
        // Named on the page: "averages for Hanoi" is a claim a reader can check,
        // "for Vietnam" is not — and one city is all these figures ever were.
        entry.climateCity = pt.city ?? null;
        // The exact point the figures came from, written down beside them. Without
        // it check-climate-plausible has no latitude to reason about and passes
        // every file blind — which is the one thing a checker must never do. It
        // is also what a wrong number is diagnosed from: Hanoi's old figures had
        // no winter because the coordinate was reading water, and nobody could
        // see that from the file (2026-09-09).
        entry.climateLat = pt.lat;
        entry.climateLng = pt.lng;
        entry.climateYears = CLIMATE_YEARS;
      }
      catch (e) {
        console.log(`  ⚠️  ${c.name} climate: ${e.message} — keeping the previous figures`);
        const old = prev.countries?.[c.name];
        if (old?.climate?.length) { entry.climate = old.climate; entry.climateCity = old.climateCity; entry.climateYears = old.climateYears; }
      }
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
