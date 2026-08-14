/**
 * Ask Wikimedia Commons what a photo IS, instead of asking a model what it
 * looks like.
 *
 * The vision gate does not merely fail to see identity — it asserts identity it
 * cannot see. Its own stored verdicts: los-angeles-eggslut MATCH, "Eggslut
 * storefront in mall setting, branding visible" (the photo is the SINGAPORE
 * branch). palawan-secret-lagoon MATCH, "Palawan setting" (it is Batanes,
 * 1,000km north). new-york-ocean-prime MATCH, "matches Ocean Prime" (Phoenix).
 * daegu-trendy-cafe MATCH, "Modern café interior" (Mumbai). A model looking at
 * a picture of a café cannot tell you WHICH café, and every one of those is
 * decided by one cheap API call.
 *
 * Commons answers it directly. For that Eggslut file the description reads
 * "Eggslut, Suntec City Mall, Singapore" and the categories include
 * "Restaurants in Singapore" and "Singapore photographs taken on 2023-08-18".
 * The uploader already told us where they stood.
 *
 * Deterministic, so it can REJECT. The model stays as a tie-breaker for the
 * things metadata cannot judge (is this a plate of food or a storefront), but
 * it must never be allowed to upgrade "cannot tell" into MATCH.
 */

import { tokens } from './commons.mjs';

const API = 'https://commons.wikimedia.org/w/api.php';
// Wikimedia asks for a real UA and throttles hard on parallel/browser-UA
// requests — a prior sweep got 528 spurious 429s that read as dead images.
const UA = 'WanderAtlasPhotoIdentity/1.0 (https://wanderatlasguides.com; pixer.vtm@gmail.com)';
const BATCH = 40; // API caps titles at 50 per request

/**
 * Commons file title from a hero URL, or null when the URL is not Commons.
 * Handles both the /thumb/ form (…/Foo.jpg/1920px-Foo.jpg) and the direct one.
 */
export function commonsTitle(url) {
  if (!url) return null;
  let m = /^https?:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/([^/]+)\//.exec(url);
  if (!m) m = /^https?:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/.exec(url);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

const strip = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * @param {string[]} titles bare file names, without the "File:" prefix
 * @returns {Promise<Map<string, {description: string, categories: string[]}>>}
 */
export async function fetchCommonsMeta(titles) {
  const out = new Map();
  const uniq = [...new Set(titles.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += BATCH) {
    const slice = uniq.slice(i, i + BATCH);
    const url = `${API}?action=query&format=json&prop=imageinfo&iiprop=extmetadata`
      + `&titles=${slice.map((t) => encodeURIComponent(`File:${t}`)).join('%7C')}`;
    let json;
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } });
      if (!res.ok) throw new Error(`${res.status}`);
      json = await res.json();
    } catch {
      continue; // a failed batch leaves those files unjudged, never mis-judged
    }
    // `normalized` maps the title we asked for to the one Commons returned
    // (underscores, capitalisation), so results can be matched back.
    const back = new Map((json.query?.normalized ?? []).map((n) => [n.to, n.from]));
    for (const page of Object.values(json.query?.pages ?? {})) {
      if (!page?.title) continue;
      const asked = (back.get(page.title) ?? page.title).replace(/^File:/, '');
      const md = page.imageinfo?.[0]?.extmetadata ?? {};
      out.set(asked, {
        description: strip(md.ImageDescription?.value),
        categories: strip(md.Categories?.value).split('|').map((c) => c.trim()).filter(Boolean),
      });
    }
    // Sequential by construction; a small gap keeps a long sweep polite.
    if (i + BATCH < uniq.length) await new Promise((r) => setTimeout(r, 400));
  }
  return out;
}

/** Word-boundary match, so "Nice" does not fire inside "Venice". */
const mentions = (haystack, needle) => {
  if (!needle || needle.length < 3) return false;
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(String.raw`(^|[^\p{L}])${esc}($|[^\p{L}])`, 'iu').test(haystack);
};

/**
 * Like mentions(), but only when the name stands alone as a PLACE — not as the
 * first word of a longer proper noun. "Central Park, NYC" mentions no district
 * called Central, yet the flat region list contains Hong Kong's Central, and
 * that single word marked a genuine Conservatory Garden photograph for
 * stripping. A capitalised word right after the match means the match is a
 * modifier of something bigger, and vouches for nothing.
 */
const mentionsAsPlace = (segments, needle) => {
  if (!needle || needle.length < 3) return false;
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The i-flag would case-fold a \p{Lu} lookahead into matching everything, so
  // the "followed by a capitalised word?" test runs separately, case-sensitive.
  // Judged per field, never on a joined blob — a description that is just
  // "Malang" must not read as "Malang Mount…" because the next category
  // happens to start with a capital.
  const re = new RegExp(String.raw`(^|[^\p{L}])${esc}(?=$|[^\p{L}])`, 'giu');
  for (const seg of segments) {
    for (const m of String(seg ?? '').matchAll(re)) {
      if (!/^\s+\p{Lu}/u.test(seg.slice(m.index + m[0].length))) return true;
    }
  }
  return false;
};

/**
 * Does this photo's own metadata place it somewhere OTHER than the post claims?
 *
 * Only ever returns a verdict it can defend. "unknown" is a real answer and is
 * the right one whenever Commons said nothing useful — the whole failure being
 * corrected here is a checker that turned "cannot tell" into "fine".
 *
 * @param {{description: string, categories: string[]}} meta
 * @param {{country: string, region: string}} claim  what the post says the place is
 * @param {{countries: string[], regions: string[]}} world  every country/city the site knows
 * @returns {{verdict: 'contradicts'|'supports'|'unknown', why: string}}
 */
export function judgeIdentity(meta, claim, world) {
  if (!meta) return { verdict: 'unknown', why: 'no Commons metadata' };
  const hay = `${meta.description} ${meta.categories.join(' ')}`.trim();
  if (!hay) return { verdict: 'unknown', why: 'Commons record is empty' };
  const fields = [meta.description, ...meta.categories];

  const namesRegion = Boolean(claim.region) && mentions(hay, claim.region);
  const namesCountry = Boolean(claim.country) && mentions(hay, claim.country);

  // The post's own city, named by the uploader, settles it — whatever else the
  // record mentions is context. This is checked FIRST because a caption in
  // another language routinely names a foreign country while describing the
  // right place: "Dick, singe du zoo de Los Angeles" sits in French categories
  // on a genuine Los Angeles photograph.
  if (namesRegion) return { verdict: 'supports', why: `Commons names ${claim.region}` };

  // A DIFFERENT country, with the post's own country absent, is the strongest
  // signal available and catches the worst class of error — a Mumbai café on a
  // Daegu page, the Singapore Eggslut on a Los Angeles page.
  const otherCountry = world.countries.find((c) => c !== claim.country && mentions(hay, c));
  if (otherCountry && !namesCountry) {
    return { verdict: 'contradicts', why: `Commons places this in ${otherCountry}, post says ${claim.country}` };
  }

  // Wrong city inside the RIGHT country is not decidable here and must not be
  // reported as a contradiction. This site's region list is flat, so it cannot
  // tell that Puerto Princesa is inside Palawan, that Yangmingshan straddles
  // Taipei and New Taipei, or that a race called "Multiple cities" passes
  // through Segovia. Every one of those was a false positive on the first run.
  // Surfaced as `nearby` for a human, never acted on automatically.
  //
  // Which country the mentioned region BELONGS to decides how loud to be. The
  // strip deletes what this branch condemns, and on 2026-08-14 it was about to
  // condemn Malang on a Mount Bromo post (Bromo sits partly in Malang regency)
  // and Dubai on Jumeirah/Downtown Dubai posts — the metro naming its own
  // district. A region from the post's own country is exactly as undecidable
  // as the Puerto Princesa case, whether or not the caption bothered to name
  // the country too. Only a region owned by a DIFFERENT country (Mumbai on a
  // Daegu page), with the post's country absent, still condemns.
  const otherRegion = world.regions.find((r) => r !== claim.region && mentionsAsPlace(fields, r));
  if (otherRegion) {
    // owner: the country that region belongs to. null = the name exists in
    // several countries (undecidable); undefined = caller supplied no map, in
    // which case only a named country can soften the verdict, as before.
    const owner = world.regionCountry?.get(otherRegion);
    const decidablyForeign = world.regionCountry ? owner != null && owner !== claim.country : true;
    return namesCountry || !decidablyForeign
      ? { verdict: 'nearby', why: `Commons names ${otherRegion}, post says ${claim.region} — same country, may be a sub-region` }
      : { verdict: 'contradicts', why: `Commons places this in ${otherRegion}, post says ${claim.region}` };
  }

  if (namesCountry) return { verdict: 'supports', why: `Commons names ${claim.country}` };
  return { verdict: 'unknown', why: 'Commons names no place this site knows' };
}

// ── Human-judged false positives ─────────────────────────────
//
// The audit's two review buckets (wrong-venue credits, same-country "nearby")
// exist precisely because this code cannot decide them — a person can, and on
// 2026-08-14 a person did, for every open case: transliterations ("Tháp Bà Po
// Nagar"), translations ("flower city square"), typos ("Boullion Gavroche"),
// and districts naming their own attraction. Re-reporting a settled case every
// day trains the reader to ignore the report, so settled cases are recorded
// and hidden. The warning list must only ever contain what a machine could
// not fix and a human has not yet seen.
//
// An entry is (slug, key) where key is the photo's own identity string — the
// Commons file title, or the full Foursquare credit line. A NEW photo on the
// same slug carries a new title/credit, misses the index, and reports again;
// nothing here ever suppresses a photo nobody has looked at.

/**
 * @param {Array<{slug: string, key: string}>} entries from data/photo-identity-judged.json
 * @returns {{has: (slug: string, key: string) => boolean, size: number}}
 */
export function makeJudgedIndex(entries) {
  const seen = new Set();
  for (const e of entries ?? []) {
    if (e && typeof e.slug === 'string' && typeof e.key === 'string' && e.slug && e.key) {
      seen.add(`${e.slug} ${e.key}`);
    }
  }
  return { size: seen.size, has: (slug, key) => seen.has(`${slug} ${key}`) };
}

// ── Foursquare: the credit line already names the venue ──────
//
// 232 live heroes come from Foursquare, where the stored credit reads
// "Photo: Foursquare user content (VENUE NAME)" — the venue the photographer
// was standing in. Eight of them name a different business than the post:
// little-india-chola-cafe credits "Bismillah Biryani", a rival restaurant;
// dubai-barrafina credits "Mercato - DIFC"; barcelona-barra-oso credits
// "El Nacional Barra de Vins". Same deterministic shape as the Commons check,
// different source.
const CREDIT_VENUE = new RegExp(String.raw`\(([^)]+)\)\s*$`);

// Words that carry no identity: two venues sharing only these are not the same
// venue. "Cafe" alone must never vouch for "Bismillah Biryani" == "Chola Cafe".
const GENERIC_VENUE_WORD = new Set([
  'cafe', 'café', 'coffee', 'restaurant', 'restaurante', 'bar', 'bistro', 'grill',
  'kitchen', 'house', 'shop', 'store', 'market', 'food', 'eatery', 'diner', 'pub',
  'the', 'and', 'club', 'lounge', 'hotel', 'resort', 'centre', 'center', 'city',
  'tours', 'tour', 'park', 'museum', 'garden', 'gardens', 'street', 'road',
]);

// Strip accents before tokenising. tokens() drops anything outside [a-z0-9],
// so "Régalade" became "r" + "galade" and stopped matching "Regalade" — the
// same venue, credited without the accent. Vietnamese tone marks did the same
// to "Mê Hội An".
const deaccent = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
const idTokens = (s) => new Set(tokens(deaccent(s)).filter((w) => !GENERIC_VENUE_WORD.has(w)));

/**
 * Does a Foursquare credit name the same business as the post?
 *
 * Deliberately lenient on spelling and length — real credits are abbreviated
 * ("Flavors Grill" for "Flavors Grill Abu Dhabi") and misspelled ("Souryana
 * Restarant and Café"). One shared distinctive word is enough to vouch; zero is
 * the signal.
 *
 * @returns {{verdict: 'contradicts'|'supports'|'unknown', why: string}}
 */
export function judgeFoursquareCredit(credit, venueName) {
  const named = CREDIT_VENUE.exec(String(credit ?? ''))?.[1]?.trim();
  if (!named) return { verdict: 'unknown', why: 'credit names no venue' };
  if (!venueName) return { verdict: 'unknown', why: 'post has no venue name' };

  const a = idTokens(named);
  const b = idTokens(venueName);
  // Nothing distinctive on either side (e.g. a venue really called "The Coffee
  // House") — cannot judge, and must not pretend to.
  if (!a.size || !b.size) return { verdict: 'unknown', why: 'no distinctive words to compare' };

  // Abbreviations and misspellings are normal in these credits — "Flavors
  // Grill" for "Flavors Grill Abu Dhabi", "Souryana Restarant" for "Souryana
  // Restaurant" — so a shared five-character prefix counts as the same word.
  const near = (x, y) => x === y || (x.length >= 5 && y.length >= 5 && (x.startsWith(y.slice(0, 5)) || y.startsWith(x.slice(0, 5))));
  const covers = (small, big) => [...small].every((w) => [...big].some((v) => near(w, v)));

  // One name CONTAINING the other is the same venue written two ways: a credit
  // of "Manly" against "Australian Cafe & Bar Manly", or "Kyoto Yoichiba"
  // against "yoichiba". Checked both directions because either side can be the
  // abbreviation.
  if (covers(a, b) || covers(b, a)) {
    return { verdict: 'supports', why: `credit "${named}" is the same name as "${venueName}"` };
  }

  // Otherwise the LEAD word decides, not any shared word. "Bismillah Biryani"
  // and "Chola Cafe & Biryani House" share "biryani" — a dish, not an identity
  // — and matching on it vouched for a photo of a rival restaurant. A venue's
  // first distinctive word is its name; the rest is usually what it sells.
  const lead = [...a][0];
  for (const v of b) if (near(lead, v)) {
    return { verdict: 'supports', why: `credit "${named}" matches venue on "${lead}"` };
  }
  return { verdict: 'contradicts', why: `credit names "${named}", post is "${venueName}"` };
}
