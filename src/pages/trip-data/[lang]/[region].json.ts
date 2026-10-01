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

// One small file per city and language, read by /my-trip (2026-10-01, owner's
// "내 여행 개선안"): the places a reader can save there, in exactly the shape
// the Save button writes (lib/tripSave), plus the city's time zone, its
// itineraries and its trip-prep links. /my-trip uses it to refresh old saves
// (hours, rating), to suggest nearby places, and to point at the course that
// already holds what the reader saved. A new guide appears here on the next
// build; nothing is kept by hand.
const LANGS: Lang[] = ['en', 'ko', 'ja', 'es', 'zh'];

const placePosts = async () =>
  (await getCollection('posts', ({ data }) => !data.draft && data.category !== 'event' && !!data.place && data.place.lat != null));

export async function getStaticPaths() {
  const regions = [...new Set((await placePosts()).map((p) => slugifyRegion(p.data.region ?? '')).filter(Boolean))];
  return LANGS.flatMap((lang) => regions.map((region) => ({ params: { lang, region } })));
}

// Google names in a non-Latin script carry it beside the Latin one; the English
// page shows the Latin part (same rule as the post page's cleanName).
const cleanName = (s?: string | null) => (s || '')
  .replace(/[؀-ۿ一-鿿가-힣฀-๿Ѐ-ӿ぀-ヿ]/g, '')
  .replace(/\s{2,}/g, ' ')
  .replace(/^[\s\-–—,·|]+|[\s\-–—,·|]+$/g, '')
  .trim();

export async function GET({ params }: { params: { lang: Lang; region: string } }) {
  const lang = params.lang;
  const t = useTranslations(lang);
  const tr = await loadCardTranslations(lang);
  const card = cardHelpers(tr, lang);
  const posts = (await placePosts()).filter((p) => slugifyRegion(p.data.region ?? '') === params.region);
  const first = posts[0]?.data;
  const regionEn = first?.region ?? '';
  const countryEn = first?.country ?? 'South Korea';
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

  // Itineraries for this city, with the stops each holds.
  const itTr = lang === 'en' ? new Map<string, any>()
    : new Map((await getCollection('itinerariesI18n', ({ data }) => data.lang === lang)).map((x) => [x.data.slug, x.data]));
  const itineraries = (await getCollection('itineraries'))
    .filter((it) => slugifyRegion(it.data.city ?? '') === params.region)
    .map((it) => ({
      href: localizePath(`/itinerary/${it.id}`, lang) + '/',
      title: itTr.get(it.id)?.title ?? it.data.title,
      days: it.data.days,
      slugs: [...new Set((it.data.itinerary ?? []).flatMap((day: any) => (day.stops ?? []).map((s: any) => s.slug)))],
    }));

  const countrySlug = countriesData.countries.find((c) => c.name === countryEn)?.slug ?? '';
  const esimHref = countrySlug && (esimFacts as Record<string, unknown>)[countrySlug]
    ? localizePath(`/tools/esim/${countrySlug}`, lang) : localizePath('/tools/esim', lang);
  const body = {
    region: params.region,
    label: localizePlace(regionEn, lang),
    country: localizePlace(countryEn, lang),
    tz: venueTimeZone(countryEn, regionEn),
    regionHref: localizePath(`/regions/${params.region}`, lang) + '/',
    itineraries,
    prep: {
      tickets: `/go/klook?to=${encodeURIComponent(klookCityDest(regionEn, klookLocale(lang)))}`,
      esim: esimHref,
      pickup: 'https://kiwitaxi.tpx.lv/yRbl5tIp?sub_id=mytrip_pickup',
      hotel: hotelUrl({ submarker: 'mytrip', locale: klookLocale(lang), place: regionEn, country: countryEn }),
    },
    places,
  };
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}
