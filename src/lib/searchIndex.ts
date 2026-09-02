// The site search index, built once per language at build time.
//
// Until 2026-09-02 every localized homepage loaded the ENGLISH index: "서울"
// on /ko/ found nothing, "Seoul" found English titles and sent the reader to
// /regions/seoul/ — off the Korean site. One builder here, called by
// /search.json and /<lang>/search.json, so the five indexes cannot drift.
//
// Each entry keeps the English name as `a` (alias): a reader on /ja/ who types
// "Kyoto" still lands on /ja/regions/kyoto/, and the localized name is what
// they see.
import type { Lang } from '../i18n/utils';
import { localizePath } from '../i18n/utils';
import { localizePlace } from '../i18n/places';
import { slugifyRegion } from './slug';

export type SearchKind = 'Country' | 'City' | 'Event' | 'Guide';
export interface SearchItem { t: string; a: string; s: string; u: string; k: SearchKind }

interface CountryRow { name: string; slug: string; continent: string }
interface PostLike { id: string; data: { title: string; region: string; country?: string; category?: string; place?: { name?: string } | null } }
interface TranslationLike { data: { slug: string; title: string } }

export function buildSearchIndex({ lang, posts, countries, translations = [] }: {
  lang: Lang;
  posts: PostLike[];
  countries: CountryRow[];
  translations?: TranslationLike[];
}): SearchItem[] {
  const items: SearchItem[] = [];
  const L = (name: string) => localizePlace(name, lang);
  const titleOf = new Map(translations.map((t) => [t.data.slug, t.data.title]));

  // Countries (that have guides)
  for (const c of countries) {
    if (posts.some((p) => (p.data.country ?? 'South Korea') === c.name)) {
      items.push({ t: L(c.name), a: c.name, s: L(c.continent), u: localizePath(`/destinations/${c.slug}/`, lang), k: 'Country' });
    }
  }

  // Cities / regions (unique). slugifyRegion + trailing slash: raw lowercasing
  // left spaces and accents in the URL for half the cities, and the build's
  // trailing-slash pass only rewrites hrefs in built HTML, not links the search
  // box injects client-side.
  const regions = new Map<string, string>();
  for (const p of posts) {
    if (!regions.has(p.data.region)) regions.set(p.data.region, p.data.country ?? 'South Korea');
  }
  for (const [r, country] of regions) {
    items.push({ t: L(r), a: r, s: L(country), u: localizePath(`/regions/${slugifyRegion(r)}/`, lang), k: 'City' });
  }

  // Guides. The venue name stays the search key in every language (readers
  // type "Sanchon", and the localized title carries it); the translated title
  // is what the result shows.
  for (const p of posts) {
    const english = p.data.place?.name ?? p.data.title;
    const shown = lang === 'en' ? english : (titleOf.get(p.id) ?? english);
    items.push({
      t: shown,
      a: english,
      s: `${L(p.data.region)}, ${L(p.data.country ?? 'South Korea')}`,
      u: localizePath(`/posts/${p.id}/`, lang),
      k: p.data.category === 'event' ? 'Event' : 'Guide',
    });
  }
  return items;
}
