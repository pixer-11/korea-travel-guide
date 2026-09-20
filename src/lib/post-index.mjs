// ─────────────────────────────────────────────────────────────
//  ONE PASS OVER THE POSTS, NOT TWELVE THOUSAND
//
//  PostArticle.astro asked the content layer six questions on every page it
//  rendered: all live posts (three separate times), the city's posts, this
//  language's translated titles, and which languages this post exists in. Each
//  answer was then filtered, mapped and sorted from scratch. With 1,700 guides
//  in five languages that is roughly nine thousand entries walked per page,
//  nine thousand pages over — a quadratic cost hidden inside a template.
//
//  Measured 2026-09-20: a full build took 69 to 171 minutes (median 88) and
//  Astro reported about 400ms per page. None of this is per-page work by
//  nature: the set of posts does not change while the site is being built.
//
//  One irony worth keeping. The itinerary backlink map already carried the
//  comment "Computed ONCE as a slug→itinerary map (not per-post work inside a
//  loop) so N posts cost one getCollection call + one pass over itineraries,
//  not N passes." It sat in the component body, so it was rebuilt for every
//  single page. This module is where "once" actually means once.
//
//  A build is one Node process, so module scope is the cache. Promises are
//  stored, not results, so two pages rendering at the same time share one load
//  instead of racing into two.
// ─────────────────────────────────────────────────────────────
import { getCollection } from 'astro:content';

const DEFAULT_COUNTRY = 'South Korea';
const countryOf = (entry) => entry.data.country ?? DEFAULT_COUNTRY;
// Bucket keys join two fields; a separator that cannot occur in either keeps
// "Nice|France" from colliding with a region literally called "Nice|France".
const SEP = String.fromCharCode(0);

let livePostsPromise = null;
/**
 * Every non-draft post, in collection order — the same array getCollection returns.
 * @returns {Promise<any[]>}
 */
export function livePosts() {
  livePostsPromise ??= getCollection('posts', ({ data }) => !data.draft);
  return livePostsPromise;
}

const memo = (build) => {
  let p = null;
  return () => (p ??= build());
};

const byCountry = memo(async () => {
  const m = new Map();
  for (const p of await livePosts()) {
    const k = countryOf(p);
    const list = m.get(k);
    if (list) list.push(p);
    else m.set(k, [p]);
  }
  return m;
});

const NONE = [];
/**
 * Live posts of one country, in collection order.
 * @param {string} [country]
 * @returns {Promise<any[]>}
 */
export async function postsInCountry(country) {
  return (await byCountry()).get(country ?? DEFAULT_COUNTRY) ?? NONE;
}

const byRegion = memo(async () => {
  const m = new Map();
  for (const p of await livePosts()) {
    const k = p.data.region;
    if (k == null) continue;
    const list = m.get(k);
    if (list) list.push(p);
    else m.set(k, [p]);
  }
  return m;
});

/**
 * Live posts of one region, whatever country — matches the old region-only filter.
 * @param {string} region
 * @returns {Promise<any[]>}
 */
export async function postsInRegion(region) {
  return (await byRegion()).get(region) ?? NONE;
}

const byRegionCountrySorted = memo(async () => {
  const m = new Map();
  for (const p of await livePosts()) {
    const k = `${p.data.region}${SEP}${countryOf(p)}`;
    const list = m.get(k);
    if (list) list.push(p);
    else m.set(k, [p]);
  }
  for (const list of m.values()) list.sort((a, b) => a.id.localeCompare(b.id));
  return m;
});

/**
 * One city's posts sorted by id — the previous/next neighbour list.
 * @param {string} region
 * @param {string} [country]
 * @returns {Promise<any[]>}
 */
export async function cityPostsSorted(region, country) {
  return (await byRegionCountrySorted()).get(`${region}${SEP}${country ?? DEFAULT_COUNTRY}`) ?? NONE;
}

let i18nPromise = null;
function allI18n() {
  i18nPromise ??= getCollection('postI18n');
  return i18nPromise;
}

const titlesByLang = memo(async () => {
  const m = new Map();
  for (const e of await allI18n()) {
    let lang = m.get(e.data.lang);
    if (!lang) m.set(e.data.lang, (lang = new Map()));
    lang.set(e.data.slug, e.data.title);
  }
  return m;
});

const EMPTY_TITLES = new Map();
/**
 * slug to translated title, for one language. An empty map when nothing is translated.
 * @param {string} lang
 * @returns {Promise<Map<string, string>>}
 */
export async function translatedTitles(lang) {
  return (await titlesByLang()).get(lang) ?? EMPTY_TITLES;
}

const langsBySlug = memo(async () => {
  const m = new Map();
  for (const e of await allI18n()) {
    let set = m.get(e.data.slug);
    if (!set) m.set(e.data.slug, (set = new Set()));
    set.add(e.data.lang);
  }
  return m;
});

const EMPTY_LANGS = new Set();
/**
 * Which languages a post has been translated into (English is never in here).
 * @param {string} slug
 * @returns {Promise<Set<string>>}
 */
export async function translationsOf(slug) {
  return (await langsBySlug()).get(slug) ?? EMPTY_LANGS;
}

const itineraryBacklinks = memo(async () => {
  const m = new Map();
  for (const it of await getCollection('itineraries', ({ data }) => !data.draft)) {
    it.data.itinerary.forEach((day, di) => {
      for (const stop of day.stops) {
        const list = m.get(stop.slug) ?? [];
        list.push({ itineraryId: it.id, city: it.data.city, days: it.data.days, dayNumber: di + 1 });
        m.set(stop.slug, list);
      }
    });
  }
  return m;
});

const NO_BACKLINKS = [];
/**
 * The itineraries a post is a stop in.
 * @param {string} slug
 * @returns {Promise<{itineraryId: string, city: string, days: number, dayNumber: number}[]>}
 */
export async function itinerariesCiting(slug) {
  return (await itineraryBacklinks()).get(slug) ?? NO_BACKLINKS;
}

// The in-body link candidates for one country in one language: every guide's
// title head, with the href a reader of that language should get. Splitting the
// head and lower-casing it is identical work for every page of that country, so
// it happens once per (country, language) pair. The caller still drops the
// current post and any name equal to its own head.
const linkTargetCache = new Map();
/**
 * @param {string} [country]
 * @param {string} lang
 * @param {{title: (r: any) => string, href: (id: string) => string}} fns
 * @returns {Promise<{id: string, name: string, lower: string, href: string}[]>}
 */
export async function linkTargetsFor(country, lang, { title, href }) {
  const key = `${country ?? DEFAULT_COUNTRY}${SEP}${lang}`;
  let p = linkTargetCache.get(key);
  if (!p) {
    p = (async () => {
      const out = [];
      for (const r of await postsInCountry(country)) {
        const name = title(r).split(/[:—|]/)[0].trim();
        // Korean/Japanese/Chinese names are short ("경복궁" is three characters);
        // the five-character floor is for Latin names, where "Bar" would link noise.
        if (name.length < (/[぀-鿿가-힯]/.test(name) ? 2 : 5)) continue;
        out.push({ id: r.id, name, lower: name.toLowerCase(), href: href(r.id) });
      }
      return out;
    })();
    linkTargetCache.set(key, p);
  }
  return p;
}

// ── the hubs ─────────────────────────────────────────────────
// RegionHub renders 1,551 pages and asked for the itineraries, the itinerary
// translations and this language's post translations on every one of them
// (170ms a page, measured 2026-09-20). None of it varies by region.

const liveItinerariesMemo = memo(() => getCollection('itineraries', ({ data }) => !data.draft));
/**
 * Every non-draft itinerary.
 * @returns {Promise<any[]>}
 */
export async function liveItineraries() {
  return liveItinerariesMemo();
}

const postDataByLang = memo(async () => {
  const m = new Map();
  for (const e of await allI18n()) {
    let lang = m.get(e.data.lang);
    if (!lang) m.set(e.data.lang, (lang = new Map()));
    lang.set(e.data.slug, e.data);
  }
  return m;
});

const EMPTY_POSTS = new Map();
/**
 * slug to the whole translated record (title, description, …) for one language.
 * @param {string} lang
 * @returns {Promise<Map<string, any>>}
 */
export async function translatedPosts(lang) {
  return (await postDataByLang()).get(lang) ?? EMPTY_POSTS;
}

const itineraryDataByLang = memo(async () => {
  const m = new Map();
  for (const e of await getCollection('itinerariesI18n')) {
    let lang = m.get(e.data.lang);
    if (!lang) m.set(e.data.lang, (lang = new Map()));
    lang.set(e.data.slug, e.data);
  }
  return m;
});

/**
 * slug to the translated itinerary record, for one language.
 * @param {string} lang
 * @returns {Promise<Map<string, any>>}
 */
export async function translatedItineraries(lang) {
  return (await itineraryDataByLang()).get(lang) ?? EMPTY_POSTS;
}
