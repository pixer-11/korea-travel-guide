import blurbs from './country-blurbs.json';
import { defaultLang, type Lang } from './ui';

// Localized one-line country descriptions. The English source lives in
// data/countries.json (used by generate.mjs); translations live in
// country-blurbs.json keyed by country slug. Falls back to the English blurb for
// any slug/lang not yet translated, so a new country degrades to English.
const TABLE = blurbs as Record<string, Partial<Record<Lang, string>>>;

export function localizeBlurb(slug: string, en: string | undefined | null, lang: Lang): string {
  const fallback = en ?? '';
  if (lang === defaultLang) return fallback;
  return TABLE[slug]?.[lang] || fallback;
}
