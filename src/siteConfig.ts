// Central brand config — change the brand in ONE place.
export const SITE = {
  name: 'Wander Atlas',
  tagline: 'Your guide to the world.',
  // No country COUNT here on purpose — this string is embedded in the sitewide
  // JSON-LD on every page, so a hardcoded number goes stale the moment a country
  // is added. Live counts are computed from the data (see HomePage.astro `live`).
  description:
    'Detailed, honest, editor-reviewed travel guides from around the world — where to go, what to eat, when to beat the crowds, and how to get around, with facts checked against live data.',
  // A rotating/featured destination to spotlight on the home page. This is ONE
  // featured pick, not the whole scope of the site.
  liveCountries: ['South Korea'],
};
