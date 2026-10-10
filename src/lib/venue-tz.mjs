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
  Macau: 'Asia/Macau',
  Uzbekistan: 'Asia/Tashkent',
  Cambodia: 'Asia/Phnom_Penh',
  'United Kingdom': 'Europe/London',
  Germany: 'Europe/Berlin',
};

const ET = 'America/New_York', CT = 'America/Chicago', PT = 'America/Los_Angeles';
const WIB = 'Asia/Jakarta', WITA = 'Asia/Makassar';
const CDMX = 'America/Mexico_City', CUN = 'America/Cancun';
const ULN = 'Asia/Ulaanbaatar', HOVD = 'Asia/Hovd';
const SYD = 'Australia/Sydney', BNE = 'Australia/Brisbane', PER = 'Australia/Perth', DRW = 'Australia/Darwin';

export const REGION_TZ = {
  'United States': {
    'New York': ET, Boston: ET, Miami: ET, 'Washington DC': ET, Philadelphia: ET,
    'East Rutherford': ET, Foxborough: ET,
    Chicago: CT, 'New Orleans': CT, Austin: CT, Nashville: CT, 'Kansas City': CT, Dallas: CT,
    'Los Angeles': PT, 'San Francisco': PT, 'Las Vegas': PT, Seattle: PT,
    'San Diego': PT, Portland: PT, Gardena: PT, 'Indian Wells': PT,
    Honolulu: 'Pacific/Honolulu', Tempe: 'America/Phoenix', // Arizona keeps no daylight time
    // Arlington (TX or VA?) and Sturgis (SD or MI?) are deliberately absent.
  },
  Indonesia: {
    Jakarta: WIB, Yogyakarta: WIB, Bandung: WIB, Surabaya: WIB, Malang: WIB,
    Medan: WIB, 'Mount Bromo': WIB, Tangerang: WIB,
    Bali: WITA, Ubud: WITA, Uluwatu: WITA, Canggu: WITA, 'Nusa Penida': WITA, Lombok: WITA,
    'Gili Islands': WITA, Mandalika: WITA, 'Labuan Bajo': WITA, Komodo: WITA,
    Makassar: WITA,
  },
  // 퀸즐랜드(브리즈번·골드코스트·선샤인코스트·케언즈)는 서머타임이 없어 시드니와 반년은
  // 1시간 어긋난다. 바이런베이는 퀸즐랜드 경계 바로 아래 NSW 라 시드니 시간,
  // 앨리스스프링스는 노던 준주라 다윈 시간(2026-09-28).
  Australia: {
    Sydney: SYD, Canberra: SYD, 'Byron Bay': SYD, Bathurst: SYD, Melbourne: 'Australia/Melbourne',
    Brisbane: BNE, 'Gold Coast': BNE, 'Sunshine Coast': BNE, Cairns: BNE,
    Perth: PER, Fremantle: PER, Adelaide: 'Australia/Adelaide', Hobart: 'Australia/Hobart',
    Darwin: DRW, 'Alice Springs': DRW,
  },
  // 멕시코는 2022년에 서머타임을 없앴다. 킨타나로오(칸쿤·플라야델카르멘·툴룸·코수멜)는
  // 멕시코시티보다 1시간 빠르고, 로스카보스(바하칼리포르니아수르)는 1시간 느리다(2026-10-04).
  Mexico: {
    'Mexico City': CDMX, Guadalajara: CDMX, Oaxaca: CDMX, 'Puerto Vallarta': CDMX,
    'San Miguel de Allende': CDMX, Guanajuato: CDMX, Puebla: CDMX,
    Monterrey: 'America/Monterrey', Merida: 'America/Merida',
    Cancun: CUN, 'Playa del Carmen': CUN, Tulum: CUN, Cozumel: CUN,
    'Los Cabos': 'America/Mazatlan',
  },
  // 몽골은 시간대가 둘이다. IANA tzdata(zone1970.tab)가 Asia/Hovd 로 두는 서부
  // 3개 아이막(바얀울기·호브드·옵스)은 울란바토르보다 1시간 늦다 — 울기·호브드가 거기다.
  // 나머지(테렐지·하르호린·흡스굴·고비 등)는 Asia/Ulaanbaatar. 서머타임 없음(2026-10-11).
  Mongolia: {
    Ulaanbaatar: ULN, Terelj: ULN, 'Tsonjin Boldog': ULN, 'Khustai National Park': ULN,
    Kharkhorin: ULN, Tsetserleg: ULN, 'Lake Khuvsgul': ULN, Murun: ULN,
    Dalanzadgad: ULN, 'Gobi Gurvansaikhan National Park': ULN, Erdenet: ULN, Darkhan: ULN,
    Olgii: HOVD, Khovd: HOVD,
  },
};

/** IANA zone for a post's country + region, or null when we don't know it. */
export function venueTimeZone(country, region) {
  const byRegion = REGION_TZ[country];
  if (byRegion) return byRegion[region] ?? null;
  return COUNTRY_TZ[country] ?? null;
}
