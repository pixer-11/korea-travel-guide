// The meta description for /events/<country>. It used to be the TITLE string
// verbatim — 85 hub pages (17 countries × 5 languages) repeated their own
// headline in the SERP snippet, found by the 2026-08-31 SEO audit. Both
// strings below already exist in ui.ts in all five languages.
export function eventsHubDescription({ t, countryLabel, upcomingCount }) {
  return upcomingCount > 0
    ? t('ev.summaryCountry').replace('{n}', String(upcomingCount))
    : t('ev.noneCountry').replace('{country}', countryLabel);
}
