// Shared path builder for the eSIM guide pages, imported by the English and the
// localized routes — one place decides "which pages exist", same reasoning as
// when-to-go-paths.mjs: duplicating the list across routes is how a country
// exists in English and 404s in Korean.
//
// A country gets an eSIM page when it is ACTIVE in countries.json AND has a
// facts entry in data/esim-facts.json. Facts are added country-by-country on
// purpose (pilot → rollout), so a new active country without facts simply has
// no page yet instead of shipping an empty one.

import countriesData from '../../data/countries.json';
import esimFacts from '../../data/esim-facts.json';

/** [{ slug, name, iso2, flag, facts }] for every country with an eSIM page. */
export function esimCountries() {
  return countriesData.countries
    .filter((c) => c.active && esimFacts[c.slug])
    .sort((a, b) => a.priority - b.priority)
    .map((c) => ({ slug: c.slug, name: c.name, iso2: c.iso2, flag: c.flag, facts: esimFacts[c.slug] }));
}
