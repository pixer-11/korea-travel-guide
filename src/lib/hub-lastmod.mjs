// Which hub pages does ONE post actually change?
//
// Until 2026-09 the answer was "the events hub and all twelve when-to-go month
// pages for its country" — for every post, including a cafe guide. Those month
// pages stopped listing the country's venues on 2026-08-07 (WhenToGoPage.astro
// moved the twelve-month table and the venue grid to the parent), so publishing
// one restaurant re-dated up to 13 URLs whose HTML did not move a byte. The
// sitemap comment claimed lastmod was the real change date; this makes it true.
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

const slugify = (s) => String(s).toLowerCase().trim().replace(/\s+/g, '-');

/** @param {{region?: string, country?: string, category?: string, eventStartDate?: string}} post */
export function hubPathsFor(post) {
  const out = [];
  const countrySlug = slugify(post.country || 'South Korea');

  if (post.region) {
    const r = slugify(post.region);
    out.push(`/regions/${r}`);
    for (const k of ['things-to-do', 'best-restaurants', 'cafes', 'hidden-gems']) out.push(`/regions/${r}/${k}`);
  }
  out.push(`/destinations/${countrySlug}`, `/essentials/${countrySlug}`);

  // The events hub lists event posts. Nothing else changes it.
  if (post.category === 'event') {
    out.push(`/events/${countrySlug}`);
    // A month page shows the events falling in THAT month. One month, not twelve.
    if (post.eventStartDate) {
      const m = new Date(post.eventStartDate).getUTCMonth();
      if (Number.isInteger(m) && MONTHS[m]) out.push(`/tools/when-to-go/${countrySlug}/${MONTHS[m]}`);
    }
  }

  out.push('/destinations', '/regions', '/tools/when-to-go', '/');
  return out;
}
