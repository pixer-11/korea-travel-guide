import countriesData from '../../data/countries.json';

// Display order for continent groups. Shared by the header nav and the
// /destinations index so the two can't drift — and, critically, ANY continent
// value found in data/countries.json that isn't in this list is appended rather
// than dropped. Previously an unlisted continent silently vanished from both the
// nav and the index (its /continents/<slug> page was built but orphaned).
export const CONTINENT_ORDER = [
  'Asia', 'Europe', 'North America', 'South America', 'Africa', 'Oceania', 'Other',
] as const;

export const continentSlug = (name: string) => name.toLowerCase().replace(/\s+/g, '-');

/**
 * Translated continent label, falling back to the raw name. Without this a
 * continent with no `continent.<Name>` translation key rendered as literal
 * "undefined" in the nav and on /destinations.
 */
export function continentLabel(t: (k: any) => string, name: string): string {
  const label = t(`continent.${name}`);
  return label && !/^continent\./.test(label) ? label : name;
}

/** Every continent present in the data, in display order, unknown ones last. */
export function orderedContinents(): string[] {
  const present = new Set(
    countriesData.countries.map((c: { continent?: string }) => c.continent || 'Other')
  );
  const known = CONTINENT_ORDER.filter((c) => present.has(c));
  const extra = [...present].filter((c) => !CONTINENT_ORDER.includes(c as any)).sort();
  return [...known, ...extra];
}
