#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  COUNTRY FACTS — monthly climate + public holidays per country.
//  Free, keyless sources:
//   • NASA POWER archive (10 complete years, averaged to monthly hi/lo/rain,
//     sampled at the country's most-covered CITY — see coordsByCountry)
//   • public holidays from the MIT-licensed `holidays` package, via
//     scripts/lib/holidays-export.py (this year + next). It replaced Nager.Date
//     on 2026-09-24: Nager's terms require sponsorship for commercial use and
//     forbid operating a holiday portal, and this site carries affiliate links.
//     The Google public-calendar fallback went with it — nothing grants the
//     right to republish those feeds.
//  Coordinates need NO per-country config: the median lat/lng of a country's
//  own venue posts is its representative point, so "add country X" keeps
//  working with zero extra setup (posts appear → facts appear).
//  Output: data/country-facts.json, rendered on /essentials/<country>.
//  Usage: node scripts/refresh-country-facts.mjs   (monthly cron + manual)
// ─────────────────────────────────────────────────────────────
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import matter from 'gray-matter';
import { climateIssues } from './check-climate-plausible.mjs';

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
//
// It returns a ranked list of candidates per country, not one point (2026-10-07).
// Macau's top region read a MERRA-2 cell that is mostly sea — August 30/29C, a
// 1.5C day-night range — and nothing tried anywhere else. main() now walks this
// list until a point passes check-climate-plausible, and each candidate carries
// its own region name, so the label is always the place the figures came from.
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
      const cur = map[country].get(region) ?? { n: 0, pts: [] };
      cur.n += 1;
      cur.pts.push({ lat: place.lat, lng: place.lng });
      map[country].set(region, cur);
    } catch {}
  }
  return Object.fromEntries(
    Object.entries(map)
      .map(([country, regions]) => [country, [...regions.entries()]
        .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
        // Every venue, not just the region's first: its first may sit in a sea
        // cell while another venue of the same city is on land. The region's
        // first venue still leads, so a country that passes today keeps its point.
        .flatMap(([city, r]) => r.pts.map((pt) => ({ ...pt, city })))])
  );
}

// POWER's meteorology grid is MERRA-2, 0.5° lat x 0.625° lng: two venues in the
// same cell return identical figures (all 20 Macau venues did, to the decimal),
// so asking twice only spends a request. Approximate on purpose — a misjudged
// boundary costs one duplicate call, never a skipped cell that mattered.
const cellOf = (pt) => `${Math.round(pt.lat / 0.5)}:${Math.round(pt.lng / 0.625)}`;
const MAX_CELLS = 4;

// Walk the candidates (most-covered region first) and keep the first point whose
// figures pass the same plausibility check CI runs. When none does, return no
// climate rather than the least-bad one: the pages hide the slot, which is
// honest, where a sea cell's 29C August night or a neighbour city's figures
// under this country's name are not.
export async function pickClimate(country, candidates, fetchClimate = climate) {
  const tried = [];
  const seen = new Set();
  for (const pt of candidates) {
    const cell = cellOf(pt);
    if (seen.has(cell)) continue;
    if (seen.size >= MAX_CELLS) break;
    seen.add(cell);
    const months = await fetchClimate(pt.lat, pt.lng);
    const issues = climateIssues(country, months, Math.abs(pt.lat));
    if (!issues.length) return { pt, months, tried };
    tried.push({ city: pt.city, lat: pt.lat, lng: pt.lng, issues });
  }
  return { pt: null, months: null, tried };
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

// Python is on every GitHub runner and on the owner's machine; the package is
// pinned in scripts/requirements-holidays.txt. A failure THROWS so main() keeps
// the previous figures instead of writing an empty list over good ones.
function holidays(iso2) {
  const y = new Date().getUTCFullYear();
  const py = process.platform === 'win32' ? 'python' : 'python3';
  const out = execFileSync(py, [join(__dirname, 'lib', 'holidays-export.py'), iso2, String(y), String(y + 1)], {
    encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  const rows = JSON.parse(out);
  if (!Array.isArray(rows)) throw new Error('holidays export did not return a list');
  const seen = new Set();
  return rows
    .filter((h) => h.date && h.name)
    .filter((h) => { const k = h.date + h.name; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function main() {
  const { countries } = JSON.parse(await readFile(join(ROOT, 'data', 'countries.json'), 'utf8'));
  // --only=Macau[,Taiwan] refreshes those countries and copies every other entry
  // through untouched: re-checking one country must not rewrite twenty-four others.
  const onlyArg = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
  const only = onlyArg ? new Set(onlyArg.split(',').map((x) => x.trim()).filter(Boolean)) : null;
  for (const n of only ?? []) {
    if (!countries.some((c) => c.active && c.name === n)) throw new Error(`--only: no active country named ${n}`);
  }
  // Keep what is already known. A rate-limited run used to write an empty file
  // over good data: 17 countries lost their climate in one pass because the API
  // answered 429. A refresh that cannot fetch should change nothing.
  let prev = { countries: {} };
  try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
  const coords = await coordsByCountry();
  // A one-country run leaves the file's date alone: the other entries are as
  // old as they were.
  const out = {
    updated: only && prev.updated ? prev.updated : new Date().toISOString().slice(0, 10),
    // A partial run starts from the whole previous map, inactive countries included.
    countries: only ? { ...(prev.countries ?? {}) } : {},
  };

  for (const c of countries.filter((c) => c.active)) {
    if (only && !only.has(c.name)) continue;
    const entry = {};
    const candidates = coords[c.name];
    if (candidates?.length) {
      let picked = null;
      try { picked = await pickClimate(c.name, candidates); }
      catch (e) {
        console.log(`  ⚠️  ${c.name} climate: ${e.message} — keeping the previous figures`);
        const old = prev.countries?.[c.name];
        // Kept only if they would pass today: a fetch failure must not
        // resurrect figures the checker now rejects (Macau's sea cell).
        // The coordinates travel with them, or the checker loses its latitude.
        const oldLat = typeof old?.climateLat === 'number' ? Math.abs(old.climateLat) : null;
        if (old?.climate?.length && !climateIssues(c.name, old.climate, oldLat).length) {
          for (const k of ['climate', 'climateCity', 'climateLat', 'climateLng', 'climateYears']) entry[k] = old[k];
        } else if (old?.climateRejected) {
          entry.climateRejected = old.climateRejected;
        }
      }
      if (picked && !picked.pt) {
        // Written down, not just logged: publish.yml refills any country with
        // no climate on every run, and without this marker it would re-ask
        // POWER for Macau's sea cell daily. The monthly refresh retries it.
        entry.climateRejected = {
          checked: new Date().toISOString().slice(0, 10),
          tried: picked.tried.map((t) => ({ city: t.city, lat: t.lat, lng: t.lng, issue: t.issues[0] })),
        };
        console.log(`  ⚠️  ${c.name} climate: no venue point gave plausible figures — publishing none (the pages hide the slot)`);
        for (const t of picked.tried) console.log(`       ${t.city}: ${t.issues[0]}`);
      } else if (picked) {
        const pt = picked.pt;
        entry.climate = picked.months;
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
    } else {
      console.log(`  ·  ${c.name}: no post coordinates yet — climate skipped`);
    }
    try { entry.holidays = holidays(c.iso2); }
    catch (e) {
      console.log(`  ⚠️  ${c.name} holidays: ${String(e.message).split(String.fromCharCode(10))[0]} — keeping the previous list`);
      entry.holidays = prev.countries?.[c.name]?.holidays ?? [];
    }
    out.countries[c.name] = entry;
    console.log(`  ✅ ${c.name}: climate ${entry.climate ? '12mo' : '—'} · holidays ${entry.holidays?.length ?? 0}`);
  }

  await writeFile(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`\n📦 wrote data/country-facts.json`);
}

// Run only as a script: the test imports pickClimate without touching the network.
if (process.argv[1] && process.argv[1].endsWith('refresh-country-facts.mjs')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
