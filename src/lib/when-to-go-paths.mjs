// Shared path builder for the when-to-go tool, imported by the English and the
// localized route. Kept in one place on purpose: duplicating "which pages exist"
// across those two files is what let the roundup rules drift apart, and a
// mismatch here would mean a month that exists in English 404s in Korean.

import { getCollection } from 'astro:content';
import countryFacts from '../../data/country-facts.json';
import eventsData from '../../data/events.json';
import countriesData from '../../data/countries.json';
import { MONTHS, monthSlug, eligibleCountries, whenToGo } from './when-to-go.mjs';

/** [{ countrySlug, month, data }] for every country with a full climate record. */
export async function whenToGoPages() {
  const posts = await getCollection('posts', ({ data }) => !data.draft);
  const slugOf = new Map(countriesData.countries.map((c) => [c.name, c.slug]));
  const out = [];
  for (const country of eligibleCountries(countryFacts)) {
    const countrySlug = slugOf.get(country);
    if (!countrySlug) continue; // not a destination we publish — no page
    for (const month of MONTHS) {
      const data = whenToGo(country, month, { countryFacts, events: eventsData, posts });
      if (data) out.push({ countrySlug, month, monthSlug: monthSlug(month), data });
    }
  }
  return out;
}

/** Country list for the index page, with venue counts. */
export async function whenToGoCountries() {
  const posts = await getCollection('posts', ({ data }) => !data.draft);
  const slugOf = new Map(countriesData.countries.map((c) => [c.name, c.slug]));
  return eligibleCountries(countryFacts)
    .filter((c) => slugOf.has(c))
    .map((country) => ({
      country,
      // The filter above guarantees this; the ?? keeps the type honest.
      slug: slugOf.get(country) ?? country,
      venues: posts.filter((p) => (p.data.country ?? 'South Korea') === country).length,
    }))
    .sort((a, b) => b.venues - a.venues || a.country.localeCompare(b.country));
}

/**
 * One entry per country, carrying all twelve of its month records.
 *
 * The country page exists because the month pages were 72–86% identical to each
 * other: the twelve-month climate table, the quiet-times list and the venue grid
 * were rendered on every one of them, so 1,020 URLs — 18% of the site — behaved
 * like a doorway set. Those three blocks describe the COUNTRY. They belong on
 * one page that the twelve link to, and the month pages keep what is actually
 * about their month.
 *
 * /tools/when-to-go/<country>/ also 404'd until now, which left 1,020 pages
 * hanging off the single global index with no parent between them.
 */
export async function whenToGoCountryPages() {
  const byCountry = new Map();
  for (const page of await whenToGoPages()) {
    const list = byCountry.get(page.countrySlug) ?? [];
    list.push(page);
    byCountry.set(page.countrySlug, list);
  }
  return [...byCountry].map(([countrySlug, pages]) => ({
    countrySlug,
    // Month order, not whatever the map happened to collect.
    months: pages.sort((a, b) => a.data.month - b.data.month),
  }));
}
