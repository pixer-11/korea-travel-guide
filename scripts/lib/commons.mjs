// Wikimedia Commons image search.
// Returns ACCURATE, freely-licensed (CC / public-domain) photos of a named
// place. Unlike stock search, a query for "Gyeongbokgung Palace" returns actual
// photos OF Gyeongbokgung — not a random palace. URLs on upload.wikimedia.org
// are content-addressed and permanent, so they're safe to hotlink from a static
// site. CC-BY/BY-SA require attribution, which we render under the image.
const UA =
  'WanderAtlas/1.0 (https://wanderatlasguides.com; contact via site)';

const stripHtml = (s = '') =>
  String(s).replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();

export const tokens = (s = '') =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

// Generic event/tour words that must NOT become the image anchor — otherwise
// "Post Malone…" anchors on "post" and "UFC Fight Night…" on "fight", matching
// unrelated photos. Skipping them keeps the anchor on the distinctive proper noun
// (the act's name), so a concert hero only matches when it's actually that act.
const ANCHOR_STOP = new Set([
  'concert', 'concerts', 'festival', 'festivals', 'tour', 'tours', 'live', 'world',
  'with', 'feat', 'featuring', 'show', 'night', 'nights', 'fight', 'grand', 'prix',
  'formula', 'open', 'cup', 'final', 'finals', 'championship', 'championships',
  'anniversary', 'opener', 'week', 'weekend', 'music', 'international', 'presents',
  'stadium', 'arena', 'vision', 'edition', 'official', 'post', 'big', 'ass', 'the',
  'and', 'asia', 'asian', 'summer', 'winter', 'series', 'games', 'league',
  // Nation adjectives — "Italian Grand Prix" must not anchor on "italian" (→ an
  // Italian landscape painting); let it fall to the event-type image.
  'italian', 'spanish', 'french', 'german', 'korean', 'japanese', 'chinese',
  'vietnamese', 'thai', 'turkish', 'indian', 'malaysian', 'indonesian', 'filipino',
  'taiwanese', 'continental', 'european', 'americas', 'national', 'live',
]);

// Most distinctive word of a name — e.g. "Gyeongbokgung Palace" -> "gyeongbokgung",
// "Post Malone – Big Ass World Tour" -> "malone", "UFC Fight Night …" -> "ufc".
export const keyToken = (s = '') => {
  const all = tokens(s); // already length > 2
  const ordinal = (w) => /^\d+(st|nd|rd|th)$/i.test(w); // "83rd" must not anchor
  const yearLike = (w) => /^(19|20)\d{2}$/.test(w); // "2026" must not anchor either
  const bad = (w) => ANCHOR_STOP.has(w) || ordinal(w) || yearLike(w);
  // If EVERY token is a stop-word/ordinal (e.g. "Italian Grand Prix" → all stops),
  // return '' — an empty anchor cleanly routes to the event-TYPE image instead of
  // falling back to all[0] ("italian") and fetching an Italian-landscape photo.
  return (
    all.find((w) => w.length > 3 && !bad(w)) ||
    all.find((w) => !bad(w)) ||
    ''
  );
};

// Raw candidate list for a query (ranked by Commons search relevance).
// Only free (CC / public-domain) JPEG/PNG files are returned.
// File titles describing something other than the place as a visitor sees it.
// Construction shots are the common trap: correctly tagged with the landmark's
// name, and full of scaffolding.
// The landmark named as a VANTAGE POINT rather than the subject: 'Chicago from
// under the Cloud Gate' is a photo of office towers, 'Michigan Avenue from Cloud
// Gate' is a photo of a street. Both name the landmark, both pass a subject
// check, and neither shows it — the Cloud Gate carousel opened with one.
const SHOT_FROM_NOT_OF = /\b(?:from|by|near|beside|outside|toward|towards|overlooking|seen\s+from|view\s+from|looking\s+at)\s+(?:the\s+|under\s+the\s+|inside\s+the\s+|in\s+front\s+of\s+the\s+)?$/i;
// Commons search is loose: a "Cloud Gate" query returned an Alan Bean NASA
// portrait (the sculpture is nicknamed The Bean) and a coffee-bean diagram.
// A candidate must actually name the subject, and must name it as the subject
// rather than as the spot the photo was taken from.
// Matched word by word rather than as one string, because Commons file names
// pluralise freely: "Phi Phi Islands" found nothing until "Phi Phi Island"
// (singular, as the uploaders wrote it) also counted.
const stem = (w) => w.replace(/(?:es|s)$/i, '');
const namesSubjectNotVantage = (title, subject) => {
  const words = String(subject || '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
  if (!words.length) return true;
  const hay = title.toLowerCase();
  const haystack = (hay.match(/[\p{L}\p{N}]{2,}/gu) || []).map(stem);
  if (!words.every((w) => haystack.includes(stem(w)))) return false;

  // Where the subject is first mentioned; everything before it decides whether
  // the photo is OF the place or merely taken FROM it.
  const first = words[0];
  const at = hay.search(new RegExp('\\b' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  return !SHOT_FROM_NOT_OF.test(title.slice(0, at < 0 ? 0 : at));
};

const UNUSABLE_SUBJECT =
  /\b(?:construction|scaffold|scaffolding|crane|renovation|restoration|demolition|closed|closure|notice|signboard|plaque|placard|floor\s?plan|diagram|blueprint|schematic|logo|poster|screenshot)\b/i;

// Why a file name disqualifies a photo, or '' if it does not. Exported so the
// hero audit applies the same test the carousel does — the Cloud Gate guide
// failed both places at once, and fixing one would have left the other.
export function heroTitleProblem(fileName, subject) {
  if (UNUSABLE_SUBJECT.test(fileName)) return 'unusable';   // construction, signage, plans
  if (!namesSubjectNotVantage(fileName, subject)) {
    const words = String(subject || '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
    const hay = (fileName.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).map(stem);
    return words.every((w) => hay.includes(stem(w))) ? 'vantage' : 'off-subject';
  }
  return '';
}

// Great-circle distance in km.
const haversine = (a, b, c, d) => {
  const R = 6371, r = Math.PI / 180;
  const dLat = (c - a) * r, dLng = (d - b) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
// How far a photo may sit from the place before it is a different place. Wide
// enough for a city-scale subject, far short of "another country".
const SAME_PLACE_KM = 30;

export async function commonsCandidates(query, limit = 10, subject = '', near = null) {
  // Ask for far more than we need. The filters below are aggressive on purpose,
  // and a Cloud Gate search that returned 8 rows kept only 1 of them — a
  // carousel needs several. Over-fetching costs one request either way.
  const fetchLimit = Math.min(50, Math.max(limit * 5, 20));
  // With coordinates, restrict the search itself to that spot on earth. This is
  // the only thing that separates Chicago's Cloud Gate from the Cloud Gate
  // Theater in Tamsui, Taiwan: both are genuinely named Cloud Gate, so the file
  // name proves nothing and neither does looking at the picture. A search for
  // the sculpture came back twelve-for-twelve Taiwanese; with nearcoord, zero.
  const geoQuery = near?.lat && near?.lng
    ? `${query} nearcoord:${SAME_PLACE_KM}km,${near.lat},${near.lng}`
    : query;

  const ask = async (search) => {
    const url =
      'https://commons.wikimedia.org/w/api.php?action=query&format=json' +
      '&generator=search&gsrnamespace=6&gsrlimit=' + fetchLimit +
      '&gsrsearch=' + encodeURIComponent(search) +
      // 2400 rather than 1600: these feed a 1080x1350 portrait social card, and
      // a 1600-wide landscape shot is blown up to fill 1350px of height.
      '&prop=imageinfo|coordinates&coprop=type&colimit=1' +
      '&iiprop=url|extmetadata|mime|size&iiurlwidth=2400&origin=*';
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) return null;
      return (await r.json().catch(() => null))?.query?.pages ?? null;
    } catch { return null; }
  };

  const keep = (pages) => Object.values(pages || {})
    .map((p) => {
      const ii = p.imageinfo?.[0];
      if (!ii || !/image\/(jpe?g|png)/i.test(ii.mime || '')) return null;
      const em = ii.extmetadata || {};
      const license = stripHtml(em.LicenseShortName?.value) || '';
      const artist = stripHtml(em.Artist?.value) || 'Wikimedia Commons contributor';
      const assessment = stripHtml(em.Assessments?.value).toLowerCase();
      const title = (p.title || '').replace(/^File:/, '').replace(/\.(jpe?g|png)$/i, '');
      return {
        title,
        index: p.index ?? 999,
        url: ii.thumburl || ii.url,
        w: ii.thumbwidth || ii.width || 0,
        h: ii.thumbheight || ii.height || 0,
        featured: /featured|quality|valued/.test(assessment),
        credit: `Photo: ${artist} / Wikimedia Commons (${license || 'CC'})`,
        license: 'wikimedia',
        source:
          ii.descriptionurl ||
          `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title || '')}`,
        licenseShort: license,
        lat: p.coordinates?.[0]?.lat ?? null,
        lng: p.coordinates?.[0]?.lon ?? null,
      };
    })
    .filter(Boolean)
    // Geotagged somewhere else entirely — a different place with the same name.
    // Untagged files pass: most Commons uploads carry no coordinates, and
    // dropping them would leave nothing to choose from.
    .filter((c) => {
      if (!near?.lat || !near?.lng || c.lat == null) return true;
      return haversine(near.lat, near.lng, c.lat, c.lng) <= SAME_PLACE_KM;
    })
    // keep only clearly-free licenses (drops "all rights reserved" edge cases)
    .filter((c) => /cc|public domain|pdm|cc0|fal/i.test(c.licenseShort))
    // A photo can be genuinely OF the subject and still be unusable. Commons has
    // deep archives, so searching a landmark surfaces its construction site, its
    // closure notice, its floor plan and its plaque alongside the landmark — and
    // a vision check passes all of them, because they ARE about it. A Cloud Gate
    // carousel went out with a crane lifting the unfinished frame and a blurred
    // "temporarily closed" sign.
    .filter((c) => !UNUSABLE_SUBJECT.test(c.title))
    .filter((c) => namesSubjectNotVantage(c.title, subject))
    // Below 1200px is upscaling into a 1080-wide social card; the closure-notice
    // slide shipped visibly soft.
    .filter((c) => (c.w || 0) >= 1200)
    .sort((a, b) => a.index - b.index);

  // With coordinates, the geo-limited search is the ONLY search. Falling back to
  // the plain one when it comes up empty is exactly how Taiwan's Cloud Gate
  // Theater got into a Chicago carousel — the fallback re-admits every
  // same-name-different-place file the coordinates just excluded. Four of five
  // test places filled all eight slots from the geo search alone; the fifth
  // (Cloud Gate) has no free photos of the sculpture at all, US copyright law
  // being what it is, and a short carousel is the right answer there.
  return keep(await ask(geoQuery)).slice(0, limit);
}

/**
 * Best accurate match for `query`.
 * @param mustInclude tokens (lower-case) that MUST appear in the file title —
 *        an anti-mismatch guard (e.g. the venue's key word or the region), so a
 *        "Gwangjang Market" query can't return a "Dongdaemun" photo.
 * @param used optional Set of already-used URLs to skip (de-duplication).
 */
// Drab / non-scenic subjects a travel hero should never be. Commons often has
// an accurately-named-but-ugly photo (e.g. "Haeundae Police Station"); relying
// on title match alone once put a police station on the Haeundae beach post.
// geograph.org.uk is exclusively BRITISH/IRISH photography — the site covers
// neither country, so ANY geograph file is by definition the wrong place
// (Art Picture House UK on an Abu Dhabi cafe, Blickling Park on a Bali village,
// Hitchin on Provence — all geograph).
const BORING =
  /geograph|police|\bstation\b|fire station|parking|office|government|city hall|district office|hospital|clinic|\bsign\b|signage|\bmap\b|diagram|schematic|construction|scaffold|toilet|restroom|manhole|number plate|license plate|logo|\bflag\b|coat of arms|panorama of reed|\bash\b|volcanic ash|eruption|erupting|\bflood(ing|ed|s)?\b|protest|\briot\b|demonstration|funeral|\bdisaster\b|shipwreck|\bwreck\b|\bcrash\b|wildfire|\bdebris\b|rubble|demolition|aftermath|heron|egret|\bbird\b|\bduck\b|pigeon|sparrow|wildlife|butterfly|insect|squirrel|\bcat\b|\bdog\b|self.?portrait|\bbabylon\b|\bincense\b|\b1[0-8]\d\d\b|\b19[0-4]\d\b|\bwar\b|warfare|\bmilitary\b|\bsoldier|\barmy\b|\bnavy\b|weapon|\bbattle\b|\bcombat\b|troops|\btank\b|artillery|refugee|prisoner|execution|massacre|genocide|\bbomb|air ?raid|casualt|\bmemorial\b|cemetery|\bgrave\b|tomb of/i;
// NOTE: cave/waterfall/grotto/ruins/ancient/pyramid were REMOVED from BORING —
// they're legit scenic ATTRACTIONS (Manjanggul Cave, Cheonjiyeon Waterfall,
// Seokguram Grotto/UNESCO). Event homonyms (Babylon→ancient, Rock en Seine→rock)
// are now blocked by crossCheck/GEO_STOP/keyToken + the vintage-year guard, not
// by banning these travel subjects.

// The LEAD image of a place's Wikipedia article — the photo Wikipedia editors
// chose as the single most representative view of that place (user directive
// 2026-07-26: heroes must be iconic AND factual, e.g. "Amalfi Coast" should be
// the classic coastal vista, not an accurately-named-but-obscure watchtower).
// Identity is stronger than filename matching: the image is attached to the
// article FOR the place. Only free Commons files pass (non-free en-wiki logos
// resolve as missing on Commons and are dropped). Returns a commonsBest-shaped
// candidate or null; callers fall back to commonsBest search.
export async function wikipediaLeadImage(name, { used, minWidth = 1000, near = null } = {}) {
  if (!name) return null;
  const wikiUrl =
    'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1' +
    '&titles=' + encodeURIComponent(name) +
    '&prop=pageimages|pageprops|coordinates&piprop=name&ppprop=disambiguation';
  let page;
  try {
    const res = await fetch(wikiUrl, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    page = Object.values((await res.json())?.query?.pages || {})[0];
  } catch {
    return null;
  }
  if (!page || page.missing !== undefined || !page.pageimage) return null;
  if (page.pageprops?.disambiguation !== undefined) return null;
  // Redirect sanity: the resolved article must still be about OUR place — its
  // title must share a token with the query (guards "Foo Cafe" → unrelated page).
  const qtok = new Set(tokens(name));
  if (!tokens(page.title || '').some((t) => qtok.has(t))) return null;
  if (BORING.test(page.pageimage)) return null;
  // The article is about a place somewhere else entirely.
  const co = page.coordinates?.[0];
  if (near?.lat && near?.lng && co && haversine(near.lat, near.lng, co.lat, co.lon) > SAME_PLACE_KM) return null;
  // The same two file-name tests every other candidate goes through: a lead
  // image can be the landmark's construction site, or the view FROM it.
  const leadName = String(page.pageimage).replace(/\.(jpe?g|png)$/i, '').replace(/_/g, ' ');
  if (heroTitleProblem(leadName, name) === 'vantage' || heroTitleProblem(leadName, name) === 'unusable') return null;

  const fileUrl =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*' +
    '&titles=' + encodeURIComponent('File:' + page.pageimage) +
    '&prop=imageinfo&iiprop=url|extmetadata|mime|size&iiurlwidth=1600';
  let fp;
  try {
    const res = await fetch(fileUrl, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    fp = Object.values((await res.json())?.query?.pages || {})[0];
  } catch {
    return null;
  }
  const ii = fp?.imageinfo?.[0];
  if (!ii || !/image\/(jpe?g|png)/i.test(ii.mime || '')) return null;
  const em = ii.extmetadata || {};
  const license = stripHtml(em.LicenseShortName?.value) || '';
  // KOGL Type 1 = Korea Open Government License, attribution-only (free for
  // commercial use; Commons hosts it) — common on Korean-heritage lead images.
  if (!/cc|public domain|pdm|cc0|fal|kogl type 1/i.test(license)) return null;
  const w = ii.thumbwidth || ii.width || 0;
  const h = ii.thumbheight || ii.height || 0;
  if (w && w < minWidth) return null;
  if (w && h && w < h * 0.95) return null; // heroes need a landscape banner
  const url = ii.thumburl || ii.url;
  if (!url || (used && used.has(url))) return null;
  const artist = stripHtml(em.Artist?.value) || 'Wikimedia Commons contributor';
  return {
    title: page.pageimage.replace(/\.(jpe?g|png)$/i, ''),
    url,
    credit: `Photo: ${artist} / Wikimedia Commons (${license || 'CC'})`,
    license: 'wikimedia',
    source:
      ii.descriptionurl ||
      `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(page.pageimage)}`,
    licenseShort: license,
  };
}

export async function commonsBest(query, { mustInclude = [], used, allowPortrait = false, minWidth = 1000, crossCheck = null, minCross = 0, subject = '', near = null } = {}) {
  // subject/near were added to commonsCandidates for the Instagram carousel and,
  // for a while, ONLY the carousel passed them — so the vantage test and the
  // geo limit did nothing at all on the path that picks the hero image every
  // article is published with. An empty subject makes namesSubjectNotVantage
  // return true for everything, so the filter was not merely weaker, it was off.
  const cands = await commonsCandidates(query, 14, subject, near);
  if (!cands.length) return null;
  const qtok = tokens(query);
  const must = mustInclude.map((s) => String(s).toLowerCase()).filter(Boolean);
  // crossCheck: require the image title to share ≥minCross tokens with these words
  // (usually the full event name). Guards an anchor-only search — "david" alone
  // must match ≥2 event-name tokens, so a "Michelangelo David" statue is rejected
  // but "Magomed Ankalaev at UFC Fight Night" (ankalaev+ufc+fight+night) passes.
  const cross = crossCheck && minCross > 0 ? new Set(crossCheck.map((t) => String(t).toLowerCase())) : null;

  const eligible = cands
    .map((c, i) => {
      const ttok = new Set(tokens(c.title));
      const overlap = qtok.filter((t) => ttok.has(t)).length;
      const crossN = cross ? [...ttok].filter((t) => cross.has(t)).length : Infinity;
      // A title token that is neither in the event name NOR a pure number is a
      // FOREIGN proper noun ("Michelangelo", "Hedgehog") = mismatch. Zero foreign
      // tokens means the title is just the act + a date ("Itzy 241023") → accept
      // even at crossN=1, so ITZY/BIGBANG-style real photos aren't false-rejected.
      const foreignN = cross ? [...ttok].filter((t) => !cross.has(t) && !/^\d+$/.test(t)).length : 0;
      const titleLc = c.title.toLowerCase();
      const passesMust = must.length === 0 || must.some((m) => titleLc.includes(m));
      // Scenery heroes want a wide banner. For events, the RIGHT image is the
      // performer/athlete — usually a PORTRAIT — so allowPortrait relaxes the
      // aspect gate (still rejecting extreme 1:>1.8 slivers) and lets a smaller
      // (≥600px) real photo through instead of a wrong-topic city fallback.
      const landscape = !c.w || !c.h || (allowPortrait ? c.h <= c.w * 1.8 : c.w >= c.h * 0.95);
      const bigEnough = !c.w || c.w >= minWidth;
      const scenic = !BORING.test(c.title);
      return { c, overlap, rank: i, ok: passesMust && overlap >= 1 && landscape && bigEnough && scenic && (!cross || crossN >= minCross || foreignN === 0) };
    })
    .filter((s) => s.ok)
    .filter((s) => !used || !used.has(s.c.url));

  if (!eligible.length) return null;
  // Prefer Commons-assessed great photos; otherwise keep Commons' own relevance
  // order (which ranks the iconic shot first), NOT raw title-token overlap.
  eligible.sort((a, b) => (b.c.featured - a.c.featured) || (a.rank - b.rank));
  return eligible[0].c;
}
