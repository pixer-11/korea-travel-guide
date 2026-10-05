// ─────────────────────────────────────────────────────────────
//  Luggage storage — Radical Storage through Travelpayouts (8% in this
//  account, connected; 2026-10-04 픽서님 "순서대로 다 처리해").
//
//  Link: Travelpayouts deep link p=5867 (the program's own example link on
//  travelpayouts.com/en/offers/radical-storage-affiliate-program/). curl
//  10-04: 302 → radicalstorage.com/<path>?track_id=<token>-754088&
//  utm_term=travelpayouts — our marker arrives with the click.
//
//  The city table is NOT a guess. It is Radical Storage's own sitemap
//  (15,367 store pages, 10-04) matched to our cities in data/countries.json,
//  kept only where the city has 3+ stores, and each city page opened: 200,
//  and its currency / addressCountry is the right country (Hong Kong's
//  "Aberdeen" is Aberdeen, Scotland — £ — and is left out; "okinawa" has no
//  page). English city pages only: the localized ones use other slugs
//  (ja tokyo → dong-jing) and 404 when guessed. n = stores in the sitemap.
//  No prices on our pages (the site rule) — Radical Storage shows its own.
//  New country or city: re-run the same match, one line each.
// ─────────────────────────────────────────────────────────────

export const RS_CITIES = {
  "Australia": [
    { city: "Sydney", slug: "sydney", n: 145 },
    { city: "Melbourne", slug: "melbourne", n: 133 },
    { city: "Brisbane", slug: "brisbane", n: 84 },
    { city: "Gold Coast", slug: "gold-coast", n: 37 },
    { city: "Perth", slug: "perth", n: 12 },
    { city: "Canberra", slug: "canberra", n: 4 },
  ],
  "France": [
    { city: "Paris", slug: "paris", n: 489 },
    { city: "Marseille", slug: "marseille", n: 91 },
    { city: "Nice", slug: "nice", n: 83 },
    { city: "Strasbourg", slug: "strasbourg", n: 45 },
    { city: "Toulouse", slug: "toulouse", n: 42 },
    { city: "Lyon", slug: "lyon", n: 35 },
    { city: "Bordeaux", slug: "bordeaux", n: 26 },
    { city: "Cannes", slug: "cannes", n: 16 },
    { city: "Annecy", slug: "annecy", n: 12 },
    { city: "Nantes", slug: "nantes", n: 11 },
    { city: "Colmar", slug: "colmar", n: 8 },
    { city: "Avignon", slug: "avignon", n: 8 },
  ],
  "Germany": [
    { city: "Berlin", slug: "berlin", n: 199 },
    { city: "Munich", slug: "munich", n: 67 },
    { city: "Hamburg", slug: "hamburg", n: 64 },
    { city: "Cologne", slug: "cologne", n: 43 },
    { city: "Düsseldorf", slug: "dusseldorf", n: 30 },
    { city: "Leipzig", slug: "leipzig", n: 11 },
    { city: "Stuttgart", slug: "stuttgart", n: 9 },
    { city: "Dresden", slug: "dresden", n: 3 },
  ],
  "Hong Kong": [
    { city: "Hong Kong", slug: "hong-kong", n: 5 },
  ],
  "Indonesia": [
    { city: "Bali", slug: "bali", n: 15 },
  ],
  "Italy": [
    { city: "Rome", slug: "rome", n: 343 },
    { city: "Milan", slug: "milan", n: 230 },
    { city: "Naples", slug: "naples", n: 156 },
    { city: "Florence", slug: "florence", n: 104 },
    { city: "Turin", slug: "turin", n: 89 },
    { city: "Venice", slug: "venice", n: 71 },
    { city: "Bologna", slug: "bologna", n: 69 },
    { city: "Palermo", slug: "palermo", n: 65 },
    { city: "Verona", slug: "verona", n: 40 },
    { city: "Genoa", slug: "genoa", n: 34 },
    { city: "Pisa", slug: "pisa", n: 32 },
    { city: "Siena", slug: "siena", n: 16 },
    { city: "Monza", slug: "monza", n: 4 },
  ],
  "Japan": [
    { city: "Tokyo", slug: "tokyo", n: 282 },
    { city: "Osaka", slug: "osaka", n: 142 },
    { city: "Kyoto", slug: "kyoto", n: 63 },
    { city: "Kobe", slug: "kobe", n: 28 },
    { city: "Sapporo", slug: "sapporo", n: 3 },
  ],
  "Malaysia": [
    { city: "Kuala Lumpur", slug: "kuala-lumpur", n: 10 },
    { city: "Penang", slug: "penang", n: 4 },
  ],
  // Added 2026-10-05 (Mexico joined after the 10-04 match). Same three rules,
  // pages opened: MX$ and addressCountry Mexico. Merida is left out — its slug
  // mixes Mérida, Spain stores in (only 1 Mexican store); Oaxaca, Tulum and
  // Puerto Vallarta show more stores live than the sitemap's 1-2, but the
  // rule is the sitemap count, so they wait for it.
  "Mexico": [
    { city: "Mexico City", slug: "mexico-city", n: 22 },
    { city: "Guadalajara", slug: "guadalajara", n: 15 },
    { city: "Cancun", slug: "cancun", n: 4 },
    { city: "Playa del Carmen", slug: "playa-del-carmen", n: 3 },
    { city: "Monterrey", slug: "monterrey", n: 3 },
  ],
  "Philippines": [
    { city: "Manila", slug: "manila", n: 6 },
  ],
  "Singapore": [
    { city: "Singapore", slug: "singapore", n: 14 },
  ],
  "South Korea": [
    { city: "Seoul", slug: "seoul", n: 154 },
    { city: "Busan", slug: "busan", n: 37 },
    { city: "Incheon", slug: "incheon", n: 29 },
    { city: "Jeju", slug: "jeju", n: 21 },
    { city: "Daegu", slug: "daegu", n: 3 },
  ],
  "Spain": [
    { city: "Barcelona", slug: "barcelona", n: 378 },
    { city: "Madrid", slug: "madrid", n: 223 },
    { city: "Valencia", slug: "valencia", n: 150 },
    { city: "Seville", slug: "seville", n: 107 },
    { city: "Malaga", slug: "malaga", n: 96 },
    { city: "Granada", slug: "granada", n: 79 },
    { city: "Bilbao", slug: "bilbao", n: 56 },
    { city: "Ibiza", slug: "ibiza", n: 23 },
    { city: "Cordoba", slug: "cordoba", n: 19 },
    { city: "Santiago de Compostela", slug: "santiago-de-compostela", n: 9 },
    { city: "Segovia", slug: "segovia", n: 8 },
    { city: "San Sebastian", slug: "san-sebastian", n: 5 },
    { city: "Toledo", slug: "toledo", n: 4 },
  ],
  "Thailand": [
    { city: "Bangkok", slug: "bangkok", n: 121 },
    { city: "Chiang Mai", slug: "chiang-mai", n: 5 },
    { city: "Phuket", slug: "phuket", n: 3 },
    { city: "Pattaya", slug: "pattaya", n: 3 },
  ],
  "Turkey": [
    { city: "Istanbul", slug: "istanbul", n: 117 },
    { city: "Antalya", slug: "antalya", n: 21 },
    { city: "Izmir", slug: "izmir", n: 10 },
    { city: "Ankara", slug: "ankara", n: 9 },
    { city: "Cappadocia", slug: "cappadocia", n: 8 },
  ],
  "United Arab Emirates": [
    { city: "Dubai", slug: "dubai", n: 63 },
    { city: "Abu Dhabi", slug: "abu-dhabi", n: 7 },
  ],
  "United Kingdom": [
    { city: "London", slug: "london", n: 660 },
    { city: "Edinburgh", slug: "edinburgh", n: 93 },
    { city: "Liverpool", slug: "liverpool", n: 79 },
    { city: "Manchester", slug: "manchester", n: 74 },
    { city: "Glasgow", slug: "glasgow", n: 52 },
    { city: "Oxford", slug: "oxford", n: 46 },
    { city: "Birmingham", slug: "birmingham", n: 45 },
    { city: "Belfast", slug: "belfast", n: 41 },
    { city: "Brighton", slug: "brighton", n: 33 },
    { city: "York", slug: "york", n: 27 },
    { city: "Bath", slug: "bath", n: 21 },
    { city: "Cambridge", slug: "cambridge", n: 15 },
    { city: "Cardiff", slug: "cardiff", n: 13 },
    { city: "Inverness", slug: "inverness", n: 3 },
  ],
  "United States": [
    { city: "New York", slug: "new-york", n: 215 },
    { city: "Miami", slug: "miami", n: 200 },
    { city: "Los Angeles", slug: "los-angeles", n: 197 },
    { city: "Boston", slug: "boston", n: 106 },
    { city: "San Francisco", slug: "san-francisco", n: 102 },
    { city: "Chicago", slug: "chicago", n: 96 },
    { city: "Washington DC", slug: "washington-dc", n: 87 },
    { city: "New Orleans", slug: "new-orleans", n: 64 },
    { city: "San Diego", slug: "san-diego", n: 63 },
    { city: "Seattle", slug: "seattle", n: 57 },
    { city: "Las Vegas", slug: "las-vegas", n: 17 },
    { city: "Philadelphia", slug: "philadelphia", n: 6 },
    { city: "Austin", slug: "austin", n: 4 },
    { city: "Portland", slug: "portland", n: 4 },
    { city: "Nashville", slug: "nashville", n: 3 },
  ],
  "Vietnam": [
    { city: "Hanoi", slug: "hanoi", n: 11 },
    { city: "Da Nang", slug: "da-nang", n: 7 },
  ],
};

const BASE = 'https://radicalstorage.com';
/**
 * Our Travelpayouts deep link to Radical Storage: a city page when we have a
 * verified one, else the home page (it searches by location).
 * @param {{ slug?: string | null, subId: string }} o
 */
export function radicalStorageUrl({ slug = null, subId }) {
  const target = slug ? `${BASE}/luggage-storage/${slug}` : `${BASE}/`;
  return `https://tp.media/r?marker=754088&trs=553157&p=5867&u=${encodeURIComponent(target)}&sub_id=${encodeURIComponent(subId)}`;
}

/** The verified cities of one country (by our country name), most stores first. */
export const storageCitiesOf = (country) => RS_CITIES[country] ?? [];
