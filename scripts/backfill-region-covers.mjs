// Region tiles with no photo (concert-city regions whose only posts are
// photoless events — Arlington, East Rutherford, Pasay City…) render as dark
// gradient squares next to photographed neighbours (owner, 2026-08-09).
// This fills them with a CITY photo from Wikimedia Commons.
//
// Identity rules (photo-identity-commons): the file's own title or snippet
// must contain the city name; skyline/landmark searches only; safe licenses
// are guaranteed by srnamespace=6 on Commons plus the license check below.
// Output: data/region-covers.json { "<region>": { url, credit } } — consumed
// as a FALLBACK by the tile pickers; a region that later gains a real post
// hero wins over this table automatically.
//
//   node scripts/backfill-region-covers.mjs           # fill missing regions
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cleanCommonsUrl } from './lib/commons.mjs';

const OUT = fileURLToPath(new URL('../data/region-covers.json', import.meta.url));
const API = 'https://commons.wikimedia.org/w/api.php';
// Commons' LicenseShortName uses SPACES ("CC BY-SA 4.0"), and the old
// hyphen-only /cc-by/ silently rejected every such file — Gardena had four
// perfectly licensed candidates and this filter turned all of them away
// (2026-08-14, third diagnosis round of one dark tile). Accept either form.
const OK_LICENSE = /cc[\s-]by|cc0|\bpd\b|public domain/i;

// region -> [search terms]. Country in the query keeps "George Town" from
// matching the wrong continent.
const TARGETS = {
  'Arlington': ['Arlington Virginia skyline', 'Arlington County Virginia'],
  'Bocaue': ['Bocaue Bulacan', 'Bocaue church Philippines'],
  'Chandigarh': ['Chandigarh Rock Garden', 'Chandigarh Capitol Complex'],
  'Downtown Dubai': ['Downtown Dubai skyline', 'Burj Khalifa Downtown Dubai', 'Dubai Fountain Downtown'],
  'East Rutherford': ['MetLife Stadium exterior', 'MetLife Stadium aerial view', 'East Rutherford New Jersey'],
  // Landmark/scenery terms only: the generic "Gardena California" search
  // returned a Cinco de Mayo parade close-up — genuinely Gardena, but many
  // identifiable private faces (children included) and no sense of place, so
  // it was rejected on manual review (2026-08-13). If none of these match,
  // the honest dark-tile warning stays until Commons has a usable photo.
  'Gardena': ['Gardena Willows Wetland Preserve', 'Gardena City Hall California', 'Gardena Boulevard California'],
  'George Town': ['George Town Penang street', 'George Town Penang'],
  'Jumeirah': ['Jumeirah Beach Dubai', 'Burj Al Arab Jumeirah Dubai', 'Jumeirah Dubai coastline'],
  'Le Castellet': ['Circuit Paul Ricard Le Castellet', 'Le Castellet Var France'],
  'Nantou': ['Sun Moon Lake Nantou', 'Sun Moon Lake Taiwan', 'Nantou County'],
  // 'New York City' removed 2026-08-09: it was a spelling-twin of the real
  // "New York" region (18 posts, plenty of photos) — the post was re-tagged.
  'Pasay City': ['Mall of Asia Pasay', 'SM Mall of Asia Manila Bay', 'Pasay skyline'],
  'Saint-Cloud': ['Parc de Saint-Cloud fountain', 'Domaine national de Saint-Cloud', 'Saint-Cloud Seine'],
  'Shenzhen': ['Shenzhen skyline', 'Shenzhen Ping An Finance Centre'],
  'Taitung': ['Sanxiantai Taitung', 'Taitung coastline Taiwan', 'Taitung County'],
  'Wuhan': ['Yellow Crane Tower Wuhan photograph', 'Wuhan skyline 2020', 'Wuhan Yangtze'],
};

const table = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Wikimedia's UA policy wants a CONTACT in the string; the bare
// 'WanderAtlasBot/1.0 (region-covers)' UA earned a sustained 429 ban on
// 2026-08-14 — two full runs reported every unfilled region as "no verifiable
// city photo found" when not one search had actually been answered.
const UA = 'WanderAtlasBot/1.0 (https://wanderatlasguides.com; region-covers)';
let throttled = false; // any get() that exhausted its retries on non-JSON
const get = async (params) => {
  const u = new URL(API);
  for (const [k, v] of Object.entries({ format: 'json', ...params })) u.searchParams.set(k, v);
  // Commons rate-limits bursts (and answers with PLAIN TEXT, not JSON — the
  // first run died parsing "You are making too many requests"). Pace + retry.
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(1500);
    const r = await fetch(u, { headers: { 'user-agent': UA } });
    const text = await r.text();
    try { return JSON.parse(text); } catch { await sleep(8000 * (attempt + 1)); }
  }
  throttled = true;
  return null;
};

for (const [region, queries] of Object.entries(TARGETS)) {
  if (table[region]) { console.log(`= ${region} (already set)`); continue; }
  let picked = null;
  for (const q of queries) {
    const s = await get({ action: 'query', list: 'search', srsearch: `${q} filetype:bitmap`, srnamespace: 6, srlimit: 8 });
    for (const hit of s?.query?.search ?? []) {
      const title = hit.title;
      if (!/\.(jpe?g|png|webp)$/i.test(title)) continue;
      // A city tile must show the city TODAY, as a photograph. The first run
      // picked "Tour de France entering St. Cloud, 1925" (a century-old B&W
      // press photo) and "Anonymous-Yellow Crane Tower" (a classical painting
      // scan) — accurate names, wrong images (caught by eye 2026-08-09).
      // No word boundary on purpose: "c1845" (circa-dates on painting scans)
      // slipped past \b(18|19)\d{2}\b and put an 1845 château engraving on the
      // Saint-Cloud tile (second catch, 2026-08-09).
      if (/(18|19)\d{2}/.test(title)) continue;
      if (/anonymous|painting|engraving|drawing|lithograph|postcard|woodcut/i.test(title)) continue;
      // identity: the FILE NAME must mention the city (not just the query)
      const city = region.split(' ')[0].toLowerCase().replace('-', '');
      const norm = title.toLowerCase().replace(/[-_]/g, '');
      const landmark = queries.some((qq) => qq.toLowerCase().split(' ').some((w) => w.length > 5 && norm.includes(w)));
      if (!norm.includes(city) && !landmark) continue;
      const info = await get({
        action: 'query', titles: title, prop: 'imageinfo',
        iiprop: 'url|size|extmetadata', iiurlwidth: 1280,
      });
      const page = Object.values(info?.query?.pages ?? {})[0];
      const ii = page?.imageinfo?.[0];
      if (!ii || (ii.width ?? 0) < 1280) continue;
      const lic = ii.extmetadata?.LicenseShortName?.value ?? '';
      if (!OK_LICENSE.test(lic)) continue;
      const artist = (ii.extmetadata?.Artist?.value ?? '').replace(/<[^>]+>/g, '').trim();
      picked = {
        // cleanCommonsUrl: imageinfo thumburls arrive with utm_* attribution
        // params that content blockers cancel — the exact defect repaired on
        // 477 posts (2026-08-10); this writer was the last one not using it.
        url: cleanCommonsUrl(ii.thumburl ?? ii.url),
        credit: `Photo: ${artist || 'Wikimedia Commons'} (${lic})`,
        source: title,
      };
      break;
    }
    if (picked) break;
  }
  if (picked) { table[region] = picked; console.log(`✓ ${region} ← ${picked.source}`); }
  // "no photo exists" and "the API stopped answering" are different verdicts:
  // conflating them cost two diagnosis rounds on 2026-08-14, when a 429 ban
  // made every unfilled region read as photo-less.
  else if (throttled) console.log(`⚠ ${region} — API throttled mid-search, result unknown (retry later)`);
  else console.log(`✗ ${region} — no verifiable city photo found`);
}
writeFileSync(OUT, JSON.stringify(table, null, 2) + '\n');
console.log(`\n${Object.keys(table).length} region cover(s) in data/region-covers.json`);
