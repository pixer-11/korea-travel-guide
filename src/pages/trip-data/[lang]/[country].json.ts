import { getCollection } from 'astro:content';
import { loadCardTranslations, cardHelpers } from '../../../i18n/cards';
import { localizePath, klookLocale, useTranslations, type Lang } from '../../../i18n/utils';
import { localizePlace } from '../../../i18n/places';
import { tripHoursAndQuiet, tripExtra } from '../../../lib/tripSave';
import { shortPlaceLabel } from '../../../lib/placeLabel.mjs';
import { wikimediaThumb } from '../../../lib/wikimediaThumb.mjs';
import { venueTimeZone } from '../../../lib/venue-tz.mjs';
import { slugifyRegion } from '../../../lib/slug';
import { klookCityDest } from '../../../lib/klookCities';
import { hotelUrl } from '../../../lib/hotel-link.mjs';
import countriesData from '../../../../data/countries.json';
import esimFacts from '../../../../data/esim-facts.json';

// One file per COUNTRY and language, read by /my-trip (2026-10-01, owner's
// "내 여행 개선안"): the places a reader can save there, in exactly the shape
// the Save button writes (lib/tripSave), and per city its time zone, its
// itineraries and its trip-prep links. /my-trip refreshes old saves from it,
// suggests nearby places and points at the course holding what was saved.
// A new guide appears here on the next build; nothing is kept by hand.
//
// Per country, not per city: one file per city was 1,271 files, and the
// deploy hit Cloudflare's 20,000-files-per-version limit (20,105, c0f56ff04).
// Per country it is ~110.
const LANGS: Lang[] = ['en', 'ko', 'ja', 'es', 'zh'];

const placePosts = async () =>
  (await getCollection('posts', ({ data }) => !data.draft && data.category !== 'event' && !!data.place && data.place.lat != null));
const countrySlug = (name: string) => countriesData.countries.find((c) => c.name === name)?.slug ?? '';

export async function getStaticPaths() {
  const slugs = [...new Set((await placePosts()).map((p) => countrySlug(p.data.country ?? 'South Korea')).filter(Boolean))];
  return LANGS.flatMap((lang) => slugs.map((country) => ({ params: { lang, country } })));
}

// Google names in a non-Latin script carry it beside the Latin one; the English
// page shows the Latin part (same rule as the post page's cleanName).
const cleanName = (s?: string | null) => (s || '')
  .replace(/[؀-ۿ一-鿿가-힣฀-๿Ѐ-ӿ぀-ヿ]/g, '')
  .replace(/\s{2,}/g, ' ')
  .replace(/^[\s\-–—,·|]+|[\s\-–—,·|]+$/g, '')
  .trim();

export async function GET({ params }: { params: { lang: Lang; country: string } }) {
  const lang = params.lang;
  const t = useTranslations(lang);
  const tr = await loadCardTranslations(lang);
  const card = cardHelpers(tr, lang);
  const posts = (await placePosts()).filter((p) => countrySlug(p.data.country ?? 'South Korea') === params.country);
  const countryEn = posts[0]?.data.country ?? 'South Korea';
  const ampm = { am: t('post.am'), pm: t('post.pm') };

  const places = posts
    .map((post) => {
      const d = post.data;
      const p: any = d.place;
      const trTitle = tr.get(post.id)?.title;
      const title = (lang === 'en' ? cleanName(p.name) : shortPlaceLabel(trTitle ?? '', lang) || cleanName(p.name)) || d.title;
      const { hours, quiet } = tripHoursAndQuiet(p, lang, ampm);
      const image = wikimediaThumb(String(d.heroImage?.url ?? ''), 500)
        .replace(/(fastly\.4sqi\.net\/img\/general\/)original\//, '$1width320/');
      return {
        slug: post.id, title,
        region: localizePlace(d.region, lang), country: localizePlace(d.country ?? 'South Korea', lang),
        href: card.href(post.id, true),
        lat: p.lat ?? null, lng: p.lng ?? null, phone: p.phone ?? '',
        hours, quiet, image: d.heroImage?.license === 'placeholder' ? '' : image,
        ...tripExtra(post),
        catLabel: t(`cat.${d.category}` as any),
      };
    })
    .sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0));

  const itTr = lang === 'en' ? new Map<string, any>()
    : new Map((await getCollection('itinerariesI18n', ({ data }) => data.lang === lang)).map((x) => [x.data.slug, x.data]));
  const allIts = await getCollection('itineraries');
  const esimHref = (esimFacts as Record<string, unknown>)[params.country]
    ? localizePath(`/tools/esim/${params.country}`, lang) : localizePath('/tools/esim', lang);

  // Per city: what the page needs about the place itself.
  const cities: Record<string, any> = {};
  for (const post of posts) {
    const rs = slugifyRegion(post.data.region ?? '');
    if (!rs || cities[rs]) continue;
    const regionEn = post.data.region;
    cities[rs] = {
      label: localizePlace(regionEn, lang),
      country: localizePlace(countryEn, lang),
      tz: venueTimeZone(countryEn, regionEn),
      regionHref: localizePath(`/regions/${rs}`, lang) + '/',
      itineraries: allIts
        .filter((it) => slugifyRegion(it.data.city ?? '') === rs)
        .map((it) => ({
          href: localizePath(`/itinerary/${it.id}`, lang) + '/',
          title: itTr.get(it.id)?.title ?? it.data.title,
          days: it.data.days,
          slugs: [...new Set((it.data.itinerary ?? []).flatMap((day: any) => (day.stops ?? []).map((s: any) => s.slug)))],
        })),
      prep: {
        tickets: `/go/klook?to=${encodeURIComponent(klookCityDest(regionEn, klookLocale(lang)))}`,
        esim: esimHref,
        pickup: 'https://kiwitaxi.tpx.lv/yRbl5tIp?sub_id=mytrip_pickup',
        hotel: hotelUrl({ submarker: 'mytrip', locale: klookLocale(lang), place: regionEn, country: countryEn }),
      },
    };
  }
  return new Response(JSON.stringify({ country: params.country, cities, places }), { headers: { 'Content-Type': 'application/json' } });
}
