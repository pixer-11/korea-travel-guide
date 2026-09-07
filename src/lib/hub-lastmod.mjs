// Which hub pages does ONE post actually change?
//
// Until 2026-09 the answer was "the events hub and all twelve when-to-go month
// pages for its country" — for every post, including a cafe guide. Those month
// pages stopped listing the country's venues on 2026-08-07 (WhenToGoPage.astro
// moved the twelve-month table and the venue grid to the parent), so publishing
// one restaurant re-dated up to 13 URLs whose HTML did not move a byte. The
// sitemap comment claimed lastmod was the real change date; this makes it true.
//
// The slug MUST be the routes' own. This module used to lowercase and dash the
// spaces itself, which agrees with slugifyRegion() on ASCII and disagrees on any
// non-ASCII letter or apostrophe: Alcañiz, Buñol and Xi'an were keyed as
// /regions/alcañiz — a path no route builds — so those three hubs plus Xi'an's
// roundup, 20 sitemap URLs across five languages, carried no lastmod at all.
// Import the one definition instead of keeping a fourth copy honest by comment;
// src/lib/slug.ts and astro.config.mjs delegate to the same module.
import { readFileSync } from 'node:fs';
import { slugify } from '../../scripts/lib/slugify.mjs';
import { MONTH_SLUGS } from './when-to-go.mjs';

// The month-slug list used to be re-typed here as `MONTHS` — a second copy of
// the exact twelve strings when-to-go.mjs already exports as MONTH_SLUGS, and
// a name that collided with when-to-go.mjs's OWN `MONTHS` (the numbers 1-12),
// both imported into astro.config.mjs's module scope. 2026-09-07: the same
// shape had already produced two real bugs this week — a re-inlined `slugify`
// that drifted for accented region names (fixed in be40164d6, see the comment
// above), and a re-inlined `isRecurringEvent` that let the sitemap and the
// page disagree. The two month lists were still identical when this was
// caught; importing the one definition closes the gap before it opens one.

// Country → continent, read from the same file the continent route reads. A
// continent hub is a grid of its countries WITH THEIR POST COUNTS, so publishing
// one guide genuinely changes it — but nothing emitted that path, and the three
// /continents/ URLs sat in the sitemap dateless in all five languages.
// readFileSync, not a JSON import: this module is loaded both by plain Node (the
// tests) and by Vite (astro.config), and it never reaches a browser bundle.
/** @type {Map<string, string>} */
const CONTINENT_OF = new Map();
try {
  const raw = JSON.parse(readFileSync(new URL('../../data/countries.json', import.meta.url), 'utf8'));
  for (const c of raw.countries) if (c.continent) CONTINENT_OF.set(c.name, c.continent);
} catch { /* a partial checkout just means no continent hubs */ }

/** @param {{region?: string, country?: string, category?: string, eventStartDate?: string}} post */
export function hubPathsFor(post) {
  const out = [];
  const country = post.country || 'South Korea';
  const countrySlug = slugify(country);

  if (post.region) {
    const r = slugify(post.region);
    out.push(`/regions/${r}`);
    for (const k of ['things-to-do', 'best-restaurants', 'cafes', 'hidden-gems']) out.push(`/regions/${r}/${k}`);
  }
  out.push(`/destinations/${countrySlug}`, `/essentials/${countrySlug}`);

  const continent = CONTINENT_OF.get(country);
  if (continent) out.push(`/continents/${slugify(continent)}`);

  // The events hub lists event posts. Nothing else changes it.
  if (post.category === 'event') {
    out.push(`/events/${countrySlug}`);
    // A month page shows the events falling in THAT month. One month, not twelve.
    if (post.eventStartDate) {
      const m = new Date(post.eventStartDate).getUTCMonth();
      if (Number.isInteger(m) && MONTH_SLUGS[m]) out.push(`/tools/when-to-go/${countrySlug}/${MONTH_SLUGS[m]}`);
    }
  }

  out.push('/destinations', '/regions', '/tools/when-to-go', '/');
  return out;
}

/**
 * Day-trip hubs can't come out of hubPathsFor(), because which hubs a post
 * freshens is a question about GEOGRAPHY, not about the post: /day-trips/kyoto/
 * lists guides from Nara and Osaka, never Kyoto's own. So it takes the whole
 * corpus and returns the hub graph's dates directly.
 *
 * Only the cards the page actually renders count — six per neighbour, six
 * neighbours, exactly the slice computeDayTrips() hands the route. A seventh
 * guide in Nara does not change /day-trips/kyoto/, and saying it did is the
 * same lie this module exists to stop telling.
 *
 * @param {{id: string, data: {lastmod?: string}}[]} posts DTOs carrying whatever
 *   computeDayTrips needs plus `data.lastmod` — the post's own YYYY-MM-DD.
 * @param {(posts: any[]) => {slug: string, neighbors: {posts: {data: {lastmod?: string}}[]}[]}[]} computeHubs
 *   src/lib/dayTrips.mjs's computeDayTrips, injected so this module stays free
 *   of the geo maths (and so a test can hand it a two-city fixture).
 * @returns {Map<string, string>} path → newest date among the cards it shows
 */
export function dayTripHubDates(posts, computeHubs) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const hub of computeHubs(posts)) {
    let newest = '';
    for (const n of hub.neighbors) {
      for (const p of n.posts) {
        const d = p.data.lastmod;
        if (d && d > newest) newest = d;
      }
    }
    if (newest) out.set(`/day-trips/${hub.slug}`, newest);
  }
  return out;
}
