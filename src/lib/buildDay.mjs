// The build's one "today". astro.config.mjs sets WA_BUILD_DAY before any page
// renders, so a build that crosses 00:00 UTC cannot call an event live in one
// file and past in another — the page, the sitemap, the hubs, the RSS and the
// calendar feeds all ask this (10-03: the sitemap and two event pages
// disagreed; then Codex found the hubs and .ics files still read the clock).
// Outside a build (tests, scripts) it is simply now. Noon UTC, so any date-only
// arithmetic on it lands on the same calendar day.
export function buildToday() {
  const day = typeof process !== 'undefined' ? process.env?.WA_BUILD_DAY : undefined;
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T12:00:00Z`) : new Date();
}
