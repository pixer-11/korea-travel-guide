import { getCollection } from 'astro:content';
import { localizePath, type Lang } from '../../../i18n/utils';
import { localizePlace } from '../../../i18n/places';
import { slugifyRegion } from '../../../lib/slug';
import { canonicalRegion } from '../../../lib/region-alias.mjs';
import { pickRepHeroUrl, regionCoverUrl, tileSize } from '../../../lib/repImage';
import { whenToGoCountryPages } from '../../../lib/when-to-go-paths.mjs';
import countriesData from '../../../../data/countries.json';

// Every city a reader can keep with the heart (regions index, city hubs), in
// one language: what /my-trip needs to show a saved city — its name, country,
// photo, guide count, and where to go next (the hub, the country's when-to-go
// page, a day-by-day itinerary when one exists). Storage holds slugs only
// (src/lib/saved-cities.ts); everything a reader sees comes from here, so a
// renamed city or a new itinerary shows up on the next build.
//
// `saved-cities` cannot collide with a country slug: the sibling route is
// /trip-data/<lang>/<country>.json and no country is called that.
const LANGS: Lang[] = ['en', 'ko', 'ja', 'es', 'zh'];
export function getStaticPaths() { return LANGS.map((lang) => ({ params: { lang } })); }

export async function GET({ params }: { params: { lang: Lang } }) {
  const lang = params.lang;
  const posts = await getCollection('posts', ({ data }) => !data.draft);
  const itins = await getCollection('itineraries', ({ data }) => !data.draft);
  const wtg = new Set((await whenToGoCountryPages()).map((c: any) => c.countrySlug));

  const byRegion = new Map<string, typeof posts>();
  for (const p of posts) {
    const key = canonicalRegion(p.data.region) ?? p.data.region;
    if (!key || key.includes('/')) continue;
    (byRegion.get(key) ?? byRegion.set(key, []).get(key)!).push(p);
  }
  const cities: Record<string, unknown> = {};
  for (const [name, list] of byRegion) {
    const tally = new Map<string, number>();
    for (const p of list) { const c = (p.data.country ?? 'South Korea').trim(); tally.set(c, (tally.get(c) ?? 0) + 1); }
    const country = [...tally].sort((a, b) => b[1] - a[1])[0][0];
    const cs = countriesData.countries.find((c) => c.name === country)?.slug ?? '';
    const slug = slugifyRegion(name);
    const url = pickRepHeroUrl(list) || regionCoverUrl(name);
    // Shortest course first: the one a first-timer is most likely to follow.
    const itin = itins.filter((i) => i.data.city.toLowerCase() === name.toLowerCase()).sort((a, b) => a.data.days - b.data.days)[0];
    cities[slug] = {
      n: localizePlace(name, lang),
      c: localizePlace(country, lang),
      g: list.length,
      img: url ? tileSize(url) : '',
      hub: localizePath(`/regions/${slug}/`, lang),
      wtg: cs && wtg.has(cs) ? localizePath(`/tools/when-to-go/${cs}/`, lang) : '',
      itin: itin ? localizePath(`/itinerary/${itin.id}`, lang) : '',
      days: itin?.data.days ?? 0,
    };
  }
  return new Response(JSON.stringify({ cities }), { headers: { 'Content-Type': 'application/json' } });
}
