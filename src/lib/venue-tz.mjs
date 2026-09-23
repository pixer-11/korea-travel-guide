// The venue's timezone, for "Open now" on the post page.
//
// "Open now" has to be read off the VENUE's clock, not the reader's: a reader
// in Hanoi looking at a Paris museum at 15:00 their time is looking at 10:00
// in Paris. The repo had no zone data, so this is the minimum: one zone per
// active country, and a per-city table for the two countries that span more
// than one (United States, Indonesia). A city we have not placed returns null
// and the page shows no status — never a guess from the wrong half of a
// continent.

export const COUNTRY_TZ = {
  'South Korea': 'Asia/Seoul',
  Japan: 'Asia/Tokyo',
  Thailand: 'Asia/Bangkok',
  France: 'Europe/Paris',
  Italy: 'Europe/Rome',
  China: 'Asia/Shanghai',
  // Mainland Spain only; the Canaries are an hour behind and are not a region.
  Spain: 'Europe/Madrid',
  Vietnam: 'Asia/Ho_Chi_Minh',
  'United Arab Emirates': 'Asia/Dubai',
  Taiwan: 'Asia/Taipei',
  Malaysia: 'Asia/Kuala_Lumpur',
  India: 'Asia/Kolkata',
  Philippines: 'Asia/Manila',
  Turkey: 'Europe/Istanbul',
  Singapore: 'Asia/Singapore',
  'Hong Kong': 'Asia/Hong_Kong',
  Uzbekistan: 'Asia/Tashkent',
  Cambodia: 'Asia/Phnom_Penh',
};

const ET = 'America/New_York', CT = 'America/Chicago', PT = 'America/Los_Angeles';
const WIB = 'Asia/Jakarta', WITA = 'Asia/Makassar';

export const REGION_TZ = {
  'United States': {
    'New York': ET, Boston: ET, Miami: ET, 'Washington DC': ET, Philadelphia: ET,
    'East Rutherford': ET, Foxborough: ET,
    Chicago: CT, 'New Orleans': CT, Austin: CT, Nashville: CT,
    'Los Angeles': PT, 'San Francisco': PT, 'Las Vegas': PT, Seattle: PT,
    'San Diego': PT, Portland: PT, Gardena: PT,
    Honolulu: 'Pacific/Honolulu',
    // Arlington (TX or VA?) and Sturgis (SD or MI?) are deliberately absent.
  },
  Indonesia: {
    Jakarta: WIB, Yogyakarta: WIB, Bandung: WIB, Surabaya: WIB, Malang: WIB,
    Medan: WIB, 'Mount Bromo': WIB, Tangerang: WIB,
    Bali: WITA, Ubud: WITA, Uluwatu: WITA, 'Nusa Penida': WITA, Lombok: WITA,
    'Gili Islands': WITA, Mandalika: WITA, 'Labuan Bajo': WITA, Komodo: WITA,
    Makassar: WITA,
  },
};

/** IANA zone for a post's country + region, or null when we don't know it. */
export function venueTimeZone(country, region) {
  const byRegion = REGION_TZ[country];
  if (byRegion) return byRegion[region] ?? null;
  return COUNTRY_TZ[country] ?? null;
}
