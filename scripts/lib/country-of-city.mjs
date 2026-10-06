// Which country a discovered city belongs to.
//
// Event discovery searches one country at a time, and the search answers with
// places just across a line we draw differently: on 2026-10-05 the China
// search returned Canton Library in Hong Kong, and the post went out filed
// under China — China's visa, currency and internet notes on a Hong Kong
// restaurant. Macau, added 10-06, is the next such line.
//
// The rule is narrow on purpose: only a city that is listed as a region of
// exactly one OTHER active country, and not of the searched one, moves.
// Anything ambiguous keeps the country it was searched under.
const norm = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * @param {string} city               the city the search named
 * @param {string} searched           the country the search was for
 * @param {{name:string, active?:boolean, regions?:string[]}[]} countries  data/countries.json
 * @returns {string} the country the post should carry
 */
export function ownCountry(city, searched, countries) {
  const c = norm(city);
  if (!c) return searched;
  const holds = (country) => (country.regions || []).some((r) => norm(r) === c) || norm(country.name) === c;
  const home = countries.find((x) => x.name === searched);
  if (home && holds(home)) return searched;
  const others = countries.filter((x) => x.active !== false && x.name !== searched && holds(x));
  return others.length === 1 ? others[0].name : searched;
}
