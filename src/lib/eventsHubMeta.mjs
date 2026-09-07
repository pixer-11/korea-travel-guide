// The meta description for /events/<country>. It used to be the TITLE string
// verbatim — 85 hub pages (17 countries × 5 languages) repeated their own
// headline in the SERP snippet, found by the 2026-08-31 SEO audit. Both
// strings below already exist in ui.ts in all five languages.
//
// 2026-09-07: the 08-31 fix swapped in ev.summaryCountry but that template
// only had an {n} token, no {country} — every hub with the same upcoming
// count (e.g. all "3 upcoming events...") got a byte-identical description
// and the country name vanished from the SERP snippet. ev.summaryCountry now
// carries {country} too in all five languages; substitute both here.
export function eventsHubDescription({ t, countryLabel, upcomingCount }) {
  return upcomingCount > 0
    ? t('ev.summaryCountry').replace('{n}', String(upcomingCount)).replace('{country}', countryLabel)
    : t('ev.noneCountry').replace('{country}', countryLabel);
}
