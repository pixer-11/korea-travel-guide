// THE VENUE'S CLOCK FROM ITS STATE OR PROVINCE — the table that does not grow.
//
// Why (2026-11-05): src/lib/venue-tz.mjs places cities by hand for the
// countries that span more than one zone, and event discovery keeps finding
// cities nobody placed — Gardena, Mandalika, Kansas City, Tempe, Bathurst,
// Indian Wells, Magelang, Batnorov, Bintan, Jembrana, every one from
// discover-events.mjs. Each one published with no zone (its on/over state and
// "open now" read off nothing) and failed venue-tz.test on the next push.
// Cities are endless; the states and provinces they sit in are a short,
// fixed list. Discovery already searches the web for the city, so it is asked
// for the province and the zone too, and this file checks the two against
// each other: a province on one clock decides by itself (and a claimed zone on
// a different clock means the province is wrong — no zone); a province that
// spans zones takes the claimed zone only when it is one of that province's.
// Placing a city by its NAME alone was tried and refused: a geocoder puts
// Badung and Karangasem in Java (a different clock) before Bali.
//
// Zones: IANA tzdata zone1970.tab, by first-level division.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REGION_TZ, AMBIGUOUS } from '../../src/lib/venue-tz.mjs';

const ET = 'America/New_York', CT = 'America/Chicago', MT = 'America/Denver', PT = 'America/Los_Angeles';
const WIB = 'Asia/Jakarta', WITA = 'Asia/Makassar', WIT = 'Asia/Jayapura';
const CDMX = 'America/Mexico_City', MTY = 'America/Monterrey', MAZ = 'America/Mazatlan';
const ULN = 'Asia/Ulaanbaatar', HOVD = 'Asia/Hovd';

/** country -> province -> zone, or the zones a province spans. */
export const PROVINCE_TZ = {
  'United States': {
    Alabama: CT, Alaska: ['America/Anchorage', 'America/Juneau', 'America/Sitka', 'America/Metlakatla', 'America/Yakutat', 'America/Nome', 'America/Adak'],
    Arizona: ['America/Phoenix', MT], // the Navajo Nation keeps daylight time
    Arkansas: CT, California: PT, Colorado: MT, Connecticut: ET, Delaware: ET, 'District of Columbia': ET,
    Florida: [ET, CT], Georgia: ET, Hawaii: 'Pacific/Honolulu', Idaho: ['America/Boise', PT], Illinois: CT,
    Indiana: ['America/Indiana/Indianapolis', ET, CT, 'America/Indiana/Knox', 'America/Indiana/Tell_City', 'America/Indiana/Petersburg',
      'America/Indiana/Vincennes', 'America/Indiana/Winamac', 'America/Indiana/Marengo', 'America/Indiana/Vevay'],
    Iowa: CT, Kansas: [CT, MT], Kentucky: ['America/Kentucky/Louisville', 'America/Kentucky/Monticello', ET, CT],
    Louisiana: CT, Maine: ET, Maryland: ET, Massachusetts: ET, Michigan: ['America/Detroit', ET, 'America/Menominee', CT],
    Minnesota: CT, Mississippi: CT, Missouri: CT, Montana: MT, Nebraska: [CT, MT], Nevada: [PT, MT],
    'New Hampshire': ET, 'New Jersey': ET, 'New Mexico': MT, 'New York': ET, 'North Carolina': ET,
    'North Dakota': [CT, MT, 'America/North_Dakota/Center', 'America/North_Dakota/New_Salem', 'America/North_Dakota/Beulah'],
    Ohio: ET, Oklahoma: CT, Oregon: [PT, 'America/Boise'], Pennsylvania: ET, 'Rhode Island': ET, 'South Carolina': ET,
    'South Dakota': [CT, MT], Tennessee: [CT, ET], Texas: [CT, MT], Utah: MT, Vermont: ET, Virginia: ET,
    Washington: PT, 'West Virginia': ET, Wisconsin: CT, Wyoming: MT,
  },
  Indonesia: {
    Aceh: WIB, 'North Sumatra': WIB, 'West Sumatra': WIB, Riau: WIB, 'Riau Islands': WIB, Jambi: WIB, Bengkulu: WIB,
    'South Sumatra': WIB, 'Bangka Belitung Islands': WIB, Lampung: WIB, Banten: WIB, Jakarta: WIB, 'West Java': WIB,
    'Central Java': WIB, Yogyakarta: WIB, 'East Java': WIB, 'West Kalimantan': WIB, 'Central Kalimantan': WIB,
    Bali: WITA, 'West Nusa Tenggara': WITA, 'East Nusa Tenggara': WITA, 'South Kalimantan': WITA, 'East Kalimantan': WITA,
    'North Kalimantan': WITA, 'North Sulawesi': WITA, Gorontalo: WITA, 'Central Sulawesi': WITA, 'West Sulawesi': WITA,
    'South Sulawesi': WITA, 'Southeast Sulawesi': WITA,
    Maluku: WIT, 'North Maluku': WIT, Papua: WIT, 'West Papua': WIT, 'Southwest Papua': WIT, 'Central Papua': WIT,
    'Highland Papua': WIT, 'South Papua': WIT,
  },
  Australia: {
    'New South Wales': ['Australia/Sydney', 'Australia/Broken_Hill', 'Australia/Lord_Howe'],
    'Australian Capital Territory': 'Australia/Sydney', 'Jervis Bay Territory': 'Australia/Sydney',
    Victoria: 'Australia/Melbourne', Queensland: ['Australia/Brisbane', 'Australia/Lindeman'],
    'South Australia': 'Australia/Adelaide', 'Western Australia': ['Australia/Perth', 'Australia/Eucla'],
    Tasmania: ['Australia/Hobart', 'Antarctica/Macquarie'], 'Northern Territory': 'Australia/Darwin',
  },
  Mexico: {
    Aguascalientes: CDMX, Chiapas: CDMX, Colima: CDMX, Guanajuato: CDMX, Guerrero: CDMX, Hidalgo: CDMX, Jalisco: CDMX,
    'Mexico City': CDMX, 'State of Mexico': CDMX, Michoacan: CDMX, Morelos: CDMX, Oaxaca: CDMX, Puebla: CDMX,
    Queretaro: CDMX, 'San Luis Potosi': CDMX, Tabasco: CDMX, Tlaxcala: CDMX, Veracruz: CDMX, Zacatecas: CDMX,
    Durango: MTY, Coahuila: [MTY, 'America/Matamoros'], 'Nuevo Leon': [MTY, 'America/Matamoros'], Tamaulipas: [MTY, 'America/Matamoros'],
    Yucatan: 'America/Merida', Campeche: 'America/Merida', 'Quintana Roo': 'America/Cancun',
    Nayarit: [MAZ, 'America/Bahia_Banderas'], Sinaloa: MAZ, 'Baja California Sur': MAZ,
    'Baja California': 'America/Tijuana', Sonora: 'America/Hermosillo',
    Chihuahua: ['America/Chihuahua', 'America/Ciudad_Juarez', 'America/Ojinaga'],
  },
  Canada: {
    // The exceptions zone1970.tab lists inside a province (Codex, 11-05): Atikokan
    // and Coral Harbour keep EST all year (America/Panama), Quebec's Lower North
    // Shore is on Atlantic time (America/Puerto_Rico), Lloydminster on Alberta's.
    Ontario: ['America/Toronto', 'America/Winnipeg', 'America/Panama'], Quebec: ['America/Toronto', 'America/Puerto_Rico'],
    'British Columbia': ['America/Vancouver', 'America/Edmonton', 'America/Dawson_Creek', 'America/Fort_Nelson'],
    Alberta: 'America/Edmonton', Saskatchewan: ['America/Regina', 'America/Swift_Current', 'America/Edmonton'], Manitoba: 'America/Winnipeg',
    'New Brunswick': 'America/Moncton', 'Nova Scotia': ['America/Halifax', 'America/Glace_Bay'], 'Prince Edward Island': 'America/Halifax',
    'Newfoundland and Labrador': ['America/St_Johns', 'America/Goose_Bay'], Yukon: ['America/Whitehorse', 'America/Dawson'],
    'Northwest Territories': ['America/Edmonton', 'America/Inuvik'],
    Nunavut: ['America/Iqaluit', 'America/Rankin_Inlet', 'America/Cambridge_Bay', 'America/Resolute', 'America/Panama'],
  },
  // zone1970.tab: Asia/Hovd is Bayan-Ölgii, Khovd and Uvs; the rest of the
  // country is on Ulaanbaatar time. Spellings vary most here, so the common
  // romanisations are aliases below.
  Mongolia: {
    'Bayan-Olgii': HOVD, Khovd: HOVD, Uvs: HOVD,
    Ulaanbaatar: ULN, Arkhangai: ULN, Bayankhongor: ULN, Bulgan: ULN, 'Darkhan-Uul': ULN, Dornod: ULN, Dornogovi: ULN,
    Dundgovi: ULN, 'Govi-Altai': ULN, Govisumber: ULN, Khentii: ULN, Khovsgol: ULN, Omnogovi: ULN, Orkhon: ULN,
    Ovorkhangai: ULN, Selenge: ULN, Sukhbaatar: ULN, Tov: ULN, Zavkhan: ULN,
  },
};

const US_CODES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

// Other names the same province goes by, keyed and valued as norm() sees them.
const ALIASES = {
  washingtondc: 'districtofcolumbia', bangkabelitung: 'bangkabelitungislands', kepulauanriau: 'riauislands',
  baliprovince: 'bali', ntb: 'westnusatenggara', ntt: 'eastnusatenggara',
  cdmx: 'mexicocity', ciudaddemexico: 'mexicocity', mexico: 'stateofmexico', edomex: 'stateofmexico', estadodemexico: 'stateofmexico',
  coahuiladezaragoza: 'coahuila', michoacandeocampo: 'michoacan', veracruzdeignaciodelallave: 'veracruz',
  newfoundland: 'newfoundlandandlabrador', pei: 'princeedwardisland', nwt: 'northwestterritories', act: 'australiancapitalterritory',
  nsw: 'newsouthwales', qld: 'queensland', wa: 'westernaustralia', nt: 'northernterritory', tas: 'tasmania', vic: 'victoria', sa: 'southaustralia',
  bayanulgii: 'bayanolgii', bayanolgiy: 'bayanolgii', hovd: 'khovd', khovdprovince: 'khovd', uvsprovince: 'uvs',
  tuv: 'tov', tuvprovince: 'tov', umnugovi: 'omnogovi', southgobi: 'omnogovi', omnogobi: 'omnogovi',
  khuvsgul: 'khovsgol', hovsgol: 'khovsgol', khuvsgol: 'khovsgol', uvurkhangai: 'ovorkhangai', ovorkhangay: 'ovorkhangai',
  gobialtai: 'govialtai', dornogobi: 'dornogovi', eastgobi: 'dornogovi', dundgobi: 'dundgovi', middlegobi: 'dundgovi',
  darkhan: 'darkhanuul', khentiy: 'khentii', hentii: 'khentii', sukhbaatarprovince: 'sukhbaatar', govisumbur: 'govisumber',
};

// "State of Mexico" stays as it is: it is the name. Everything else that only
// says what kind of division it is goes.
const norm = (s) => {
  const k = String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/\b(?:special capital region of|special region of|daerah istimewa|dki|di|province of|state of(?! mexico)|province|state(?! of mexico)|aimag|prefecture)\b/g, ' ')
    .replace(/[^a-z]/g, '');
  return ALIASES[k] ?? k;
};

const INDEX = Object.fromEntries(Object.entries(PROVINCE_TZ).map(([c, m]) => [c, new Map(Object.keys(m).map((p) => [norm(p), p]))]));

/** The table's own name for a province, or null. */
export function provinceOf(country, raw) {
  const idx = INDEX[country];
  if (!idx || typeof raw !== 'string' || !raw.trim()) return null;
  if (country === 'United States' && US_CODES[raw.trim().toUpperCase()]) return US_CODES[raw.trim().toUpperCase()];
  return idx.get(norm(raw)) ?? null;
}

const valid = (tz) => {
  if (typeof tz !== 'string' || !tz.includes('/')) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
};
// Two names for one clock (America/Detroit and America/New_York): the same
// UTC offset in mid-January and mid-July of this year.
const offset = (tz, month) => {
  const d = new Date(Date.UTC(new Date().getUTCFullYear(), month, 15, 12));
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value;
};
export const sameClock = (a, b) => offset(a, 0) === offset(b, 0) && offset(a, 6) === offset(b, 6);

/**
 * The zone for a city from the province and zone the search reported.
 * @returns {{ tz: string|null, province: string|null, why: string }}
 */
export function zoneFromProvince(country, province, claimed) {
  const p = provinceOf(country, province);
  if (!p) return { tz: null, province: null, why: `province not recognised: ${JSON.stringify(province ?? null)}` };
  const spans = [PROVINCE_TZ[country][p]].flat();
  const said = valid(claimed) ? claimed : null;
  if (spans.length === 1) {
    if (said && !sameClock(spans[0], said)) return { tz: null, province: p, why: `${p} is on ${spans[0]}, the search said ${said}` };
    return { tz: spans[0], province: p, why: `${p}` };
  }
  if (!said) return { tz: null, province: p, why: `${p} spans ${spans.length} zones and the search named none` };
  const hit = spans.find((z) => z === said) ?? spans.find((z) => sameClock(z, said));
  if (!hit) return { tz: null, province: p, why: `${said} is not one of ${p}'s zones` };
  return { tz: hit, province: p, why: `${p}, ${said}` };
}

export const LEARNED_FILE = fileURLToPath(new URL('../../src/lib/venue-tz-learned.mjs', import.meta.url));
const HEAD = `// MACHINE-WRITTEN by scripts/discover-events.mjs through scripts/lib/province-tz.mjs.
// The zone of every city discovery placed in a country that spans more than
// one, decided from the city's province (see that file). Hand entries in
// venue-tz.mjs win. tz null: the city could not be placed — its page shows no
// local-time state, and "why" says what was missing. Edit venue-tz.mjs instead.
export default `;

export function readLearned(file = LEARNED_FILE) {
  try {
    const text = readFileSync(file, 'utf8');
    return JSON.parse(text.slice(text.indexOf('export default ') + 'export default '.length).replace(/;\s*$/, ''));
  } catch { return {}; }
}

/**
 * Place a newly discovered city once, in the learned table, unless a zone is
 * already known for it. Returns the entry written, or null when nothing was.
 */
export function learnVenueZone(country, city, province, claimed, { file = LEARNED_FILE, learned = readLearned(file), log = console.log } = {}) {
  if (!REGION_TZ[country] || !city || REGION_TZ[country][city] || AMBIGUOUS[country]?.includes(city)) return null;
  const { tz, province: p, why } = zoneFromProvince(country, province, claimed);
  const had = learned[country]?.[city];
  let entry = { tz, ...(p && { province: p }), ...(!tz && { why }) };
  if (had) {
    // Seen before. The same place again changes nothing; a city of the same
    // name in another province on another clock (Springfield, Illinois and
    // Springfield, Massachusetts — Codex, 11-05) means the name alone cannot
    // say which, so it is placed nowhere, as Arlington and Sturgis are by hand.
    // A city first left unplaced (its province spans zones and the search named
    // none) is placed when it comes back in the SAME province with its zone;
    // in another province it may be another place, and stays unplaced.
    if (!had.tz && tz && had.province && p === had.province) entry = { tz, province: p };
    else if (tz && had.tz && !sameClock(tz, had.tz) && p !== had.province) {
      entry = { tz: null, why: `two places by this name: ${had.province} (${had.tz}) and ${p} (${tz})` };
    } else return null;
  }
  (learned[country] ??= {})[city] = entry;
  writeFileSync(file, HEAD + JSON.stringify(learned, null, 2) + ';\n', 'utf8');
  log(tz ? `   🕒 ${city}, ${country}: ${tz} (${why})` : `   ⚠️  ${city}, ${country}: no zone — ${why}`);
  return entry;
}
