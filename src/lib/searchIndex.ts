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
import { postHref } from './postHref';
import type { Lang } from '../i18n/utils';
import { localizePath } from '../i18n/utils';
import { localizePlace } from '../i18n/places';
import { slugifyRegion } from './slug';
import { venueTimeZone } from './venue-tz.mjs';

// Itinerary joined 2026-11-02: the site calls its itineraries the product, and
// the one search box on the site could not find them — "도쿄" listed the city,
// three ended events and four guides, never "Tokyo in 3 days".
export type SearchKind = 'Country' | 'City' | 'Itinerary' | 'Event' | 'Guide';
// `e`: an event's last day (YYYY-MM-DD); `z`: the venue's time zone. The box
// judges "ended" in the browser by the VENUE's date (lib/evDay isOver) — the
// same verdict the events hubs use, so search and /events/ cannot disagree
// across time zones (Codex, 11-02). The index is static and rebuilt once a
// day, so a build-day verdict would be a day late for half the world.
export interface SearchItem { t: string; a: string; s: string; u: string; k: SearchKind; e?: string; z?: string }

interface CountryRow { name: string; slug: string; continent: string }
interface PostLike { id: string; data: { title: string; region: string; country?: string; category?: string; place?: { name?: string } | null; eventStartDate?: Date; eventEndDate?: Date } }
interface TranslationLike { data: { slug: string; title: string } }
interface ItineraryLike { id: string; data: { title: string; city: string; country?: string; draft?: boolean } }

const isoDay = (d?: Date) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : undefined);

export function buildSearchIndex({ lang, posts, countries, translations = [], itineraries = [], itineraryTranslations = [] }: {
  lang: Lang;
  posts: PostLike[];
  countries: CountryRow[];
  translations?: TranslationLike[];
  itineraries?: ItineraryLike[];
  itineraryTranslations?: TranslationLike[];
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

  // Itineraries: every one renders in every language (the page falls back to
  // English prose until translated), so the URL is always the localized one.
  // The city stays searchable in both forms: "도쿄" and "Tokyo".
  const itinTitle = new Map(itineraryTranslations.map((t) => [t.data.slug, t.data.title]));
  for (const it of itineraries) {
    if (it.data.draft) continue;
    const city = it.data.city;
    items.push({
      t: lang === 'en' ? it.data.title : (itinTitle.get(it.id) ?? it.data.title),
      a: `${it.data.title} ${city}`,
      s: `${L(city)}${it.data.country ? `, ${L(it.data.country)}` : ''}`,
      u: localizePath(`/itinerary/${it.id}/`, lang),
      k: 'Itinerary',
    });
  }

  // Guides. The venue name stays the search key in every language (readers
  // type "Sanchon", and the localized title carries it); the translated title
  // is what the result shows.
  for (const p of posts) {
    const english = p.data.place?.name ?? p.data.title;
    const shown = lang === 'en' ? english : (titleOf.get(p.id) ?? english);
    const isEvent = p.data.category === 'event';
    // The end date only, as the events hubs judge it: an event with no end date
    // is never "over" there, so it is not over here either (Codex, 11-02).
    const last = isEvent ? isoDay(p.data.eventEndDate) : undefined;
    const zone = last ? venueTimeZone(p.data.country ?? 'South Korea', p.data.region) : undefined;
    items.push({
      t: shown,
      a: english,
      s: `${L(p.data.region)}, ${L(p.data.country ?? 'South Korea')}`,
      u: postHref(p.id, lang, titleOf, true), // English when this language has no translation yet
      k: isEvent ? 'Event' : 'Guide',
      ...(last ? { e: last } : {}),
      ...(zone ? { z: zone } : {}),
    });
  }
  return items;
}
