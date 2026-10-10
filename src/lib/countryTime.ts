// Per-country facts the essentials hub needs that the guides do not carry.
//
// Time zones are IANA names, so the browser works out the offset itself —
// daylight saving included — against the READER's own clock (a reader in
// Seoul and one in Madrid see different "hours ahead"). Countries spanning
// several zones name the city the time is shown for, and say so on the page.
// Keyed by ISO 3166 alpha-2, as data/countries.json. A country missing here
// simply shows no time cell; add it when the country is added.
export const COUNTRY_TIME: Record<string, { tz: string; city: string; multi?: boolean }> = {
  KR: { tz: 'Asia/Seoul', city: 'Seoul' },
  JP: { tz: 'Asia/Tokyo', city: 'Tokyo' },
  US: { tz: 'America/New_York', city: 'New York', multi: true },
  TH: { tz: 'Asia/Bangkok', city: 'Bangkok' },
  FR: { tz: 'Europe/Paris', city: 'Paris' },
  IT: { tz: 'Europe/Rome', city: 'Rome' },
  CN: { tz: 'Asia/Shanghai', city: 'Beijing' },
  ES: { tz: 'Europe/Madrid', city: 'Madrid' },
  VN: { tz: 'Asia/Ho_Chi_Minh', city: 'Hanoi' },
  AE: { tz: 'Asia/Dubai', city: 'Dubai' },
  TW: { tz: 'Asia/Taipei', city: 'Taipei' },
  ID: { tz: 'Asia/Jakarta', city: 'Jakarta', multi: true },
  MY: { tz: 'Asia/Kuala_Lumpur', city: 'Kuala Lumpur' },
  IN: { tz: 'Asia/Kolkata', city: 'New Delhi' },
  PH: { tz: 'Asia/Manila', city: 'Manila' },
  TR: { tz: 'Europe/Istanbul', city: 'Istanbul' },
  SG: { tz: 'Asia/Singapore', city: 'Singapore' },
  HK: { tz: 'Asia/Hong_Kong', city: 'Hong Kong' },
  MO: { tz: 'Asia/Macau', city: 'Macau' },
  MN: { tz: 'Asia/Ulaanbaatar', city: 'Ulaanbaatar', multi: true }, // Olgii and Khovd run on Asia/Hovd, an hour behind
  UZ: { tz: 'Asia/Tashkent', city: 'Tashkent' },
  KH: { tz: 'Asia/Phnom_Penh', city: 'Phnom Penh' },
  AU: { tz: 'Australia/Sydney', city: 'Sydney', multi: true },
  GB: { tz: 'Europe/London', city: 'London' },
  DE: { tz: 'Europe/Berlin', city: 'Berlin' },
  MX: { tz: 'America/Mexico_City', city: 'Mexico City', multi: true },
};

// Hub regions. countries.json files Turkey, the UAE and Uzbekistan under
// "Asia"; the hub groups them as the mock-up does. Geography, not data that
// changes: a new country lands in its continent's group automatically, and in
// the Middle East / Central Asia group only if its code is listed here.
const MIDDLE_EAST_CENTRAL_ASIA = new Set(['AE', 'TR', 'UZ', 'SA', 'QA', 'OM', 'BH', 'KW', 'JO', 'IL', 'EG', 'KZ', 'KG', 'TJ', 'TM', 'GE', 'AM', 'AZ']);
export type HubRegion = 'asia' | 'europe' | 'meca' | 'africa' | 'amoc';
export function hubRegion(continent: string | undefined, iso2: string): HubRegion {
  if (MIDDLE_EAST_CENTRAL_ASIA.has(iso2.toUpperCase())) return 'meca';
  if (continent === 'Europe') return 'europe';
  if (continent === 'Asia') return 'asia';
  // An African country fell through to "Americas & Oceania" (Codex review, 10-01).
  if (continent === 'Africa') return 'africa';
  return 'amoc';
}
