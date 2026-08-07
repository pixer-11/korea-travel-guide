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
  const otherRegion = world.regions.find((r) => r !== claim.region && mentions(hay, r));
  if (otherRegion) {
    return namesCountry
      ? { verdict: 'nearby', why: `Commons names ${otherRegion}, post says ${claim.region} — same country, may be a sub-region` }
      : { verdict: 'contradicts', why: `Commons places this in ${otherRegion}, post says ${claim.region}` };
  }

  if (namesCountry) return { verdict: 'supports', why: `Commons names ${claim.country}` };
  return { verdict: 'unknown', why: 'Commons names no place this site knows' };
}
