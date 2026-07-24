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
