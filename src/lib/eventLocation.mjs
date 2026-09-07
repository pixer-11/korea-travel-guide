// schema.org Place for an event post. The venue is stored (content.config.ts
// `eventVenue`) but the JSON-LD used to print the CITY as both the place name
// and the locality, so "Circuit of the Americas" reached Google as "Austin" —
// the entity a venue query needs, thrown away. Found 2026-08-31; 32 posts
// carry a real venue today (re-measured 2026-09-07), and the rest correctly
// fall back to the city.
export function eventLocation({ venue, region, countryISO }) {
  const name = String(venue ?? '').trim() || region;
  return {
    '@type': 'Place',
    name,
    address: {
      '@type': 'PostalAddress',
      addressLocality: region,
      ...(countryISO && { addressCountry: countryISO }),
    },
  };
}
