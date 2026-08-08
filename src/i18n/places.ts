import places from './places.json';
import { defaultLang, type Lang } from './ui';

// Localized country/city names. These are DATA (they come from posts and
// countries.json), so they can't live in the UI dictionary — the table is built
// by scripts/build-place-names.mjs. Falls back to the English name whenever a
// place isn't in the table yet (e.g. a brand-new city published today), so a
// missing entry degrades to English rather than breaking the page.
const TABLE = places as Record<string, Partial<Record<Lang, string>>>;

export function localizePlace(name: string | undefined | null, lang: Lang): string {
  const n = (name ?? '').trim();
  if (!n || lang === defaultLang) return n;
  return TABLE[n]?.[lang] || n;
}

// Venue (attraction) names for UI surfaces that print one outside a translated
// article — the home's crowd demo showed "Nara Park" in Latin on the ko page
// because localizePlace only knows regions/countries. Built from the demo
// pool by scripts/translate-venue-names.mjs; conventional exonyms only, so a
// missing language falls back to the original name on purpose.
import venueNames from './venue-names.json';
const VENUES = venueNames as Record<string, Partial<Record<Lang, string>>>;

export function localizeVenue(name: string | undefined | null, lang: Lang): string {
  const n = (name ?? '').trim();
  if (!n || lang === defaultLang) return n;
  return VENUES[n]?.[lang] || localizePlace(n, lang);
}
