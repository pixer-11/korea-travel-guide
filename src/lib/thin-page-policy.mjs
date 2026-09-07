// Is a when-to-go MONTH page worth a crawl budget? Task 6 of the 2026-09-01 SEO
// uniformity plan (see .superpowers/sdd/2026-09-01-seo-uniformity-remediation/
// task-6-brief.md): 45 of the 240 country×month pages have neither a public
// holiday nor an event that month — nothing month-specific beyond the climate
// numbers every one of the other eleven months on that country already shows.
// Those 45 (x5 languages = 225 URLs) get noindex + drop out of the sitemap.
//
// Deliberately does NOT export an isIndexableRegionHub. Region hubs were
// evaluated for the same treatment (314 hubs, 143 with two posts or fewer) and
// the owner explicitly spared them (2026-08-31 decision, recorded in
// task-6-brief.md): a region hub always carries a real place list, its own
// intro copy and an FAQ, so "two posts" is not "nothing" the way "no holiday,
// no event" is for a month page. Region hubs are also the exact page class
// that cost the site 40% of its traffic when 92 of them were deleted outright
// on 2026-07-26 — the decision was made once, deliberately, and re-litigating
// it in code (by writing a predicate nobody asked for) is how that mistake
// comes back. If this ever needs to change, it is a new owner decision, not a
// missing function.
//
// ONE predicate, in one place, imported by both the route (WhenToGoPage.astro,
// which sets <meta name="robots"> via BaseLayout's noindex prop) and the build
// config (astro.config.mjs, which excludes the same slugs from the sitemap).
// This repo already shipped the two-copies version of this bug once: the
// isRecurringEvent comment above noindexSlugs() in astro.config.mjs tells that
// story for event posts. A month page must not repeat it — if the route and
// the sitemap ever computed "has events / has holidays" differently, the
// sitemap would submit a URL the page tells crawlers to ignore, or vice versa.

/**
 * Derive the two booleans this policy runs on from a `whenToGo()` result
 * (src/lib/when-to-go.mjs). Kept as its own function, rather than inlined at
 * each call site, because these are the exact two expressions
 * WhenToGoPage.astro renders its "no events" / "no holidays" fallback copy
 * from (`data.holidays.length > 0`, and
 * `data.events.length > 0 || (data.eventPosts?.length ?? 0) > 0`) — one place
 * to keep the page's own visible content and its indexability decision in
 * sync.
 * @param {{ holidays?: unknown[], events?: unknown[], eventPosts?: unknown[] }} data
 */
export function monthPageSignals(data) {
  return {
    hasHolidays: (data?.holidays?.length ?? 0) > 0,
    hasEvents: (data?.events?.length ?? 0) > 0 || (data?.eventPosts?.length ?? 0) > 0,
  };
}

/**
 * A month page earns its index slot the moment it has EITHER a holiday or an
 * event that month — either one gives a reader something specific to this
 * country in this month that the other eleven month pages for the same
 * country don't say. Only the page with neither is the doorway page: climate
 * numbers alone, restated 240 times across the site.
 * @param {{ hasEvents: boolean, hasHolidays: boolean }} signals
 */
export function isIndexableMonthPage({ hasEvents, hasHolidays }) {
  return hasEvents || hasHolidays;
}
