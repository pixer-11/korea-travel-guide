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
  return (
    all.find((w) => w.length > 3 && !ANCHOR_STOP.has(w) && !ordinal(w)) ||
    all.find((w) => !ANCHOR_STOP.has(w) && !ordinal(w)) ||
    all[0] ||
    ''
  );
};

// Raw candidate list for a query (ranked by Commons search relevance).
// Only free (CC / public-domain) JPEG/PNG files are returned.
export async function commonsCandidates(query, limit = 10) {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json' +
    '&generator=search&gsrnamespace=6&gsrlimit=' + limit +
    '&gsrsearch=' + encodeURIComponent(query) +
    '&prop=imageinfo&iiprop=url|extmetadata|mime|size&iiurlwidth=1600&origin=*';

  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA } });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  const pages = data?.query?.pages;
  if (!pages) return [];

  return Object.values(pages)
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
      };
    })
    .filter(Boolean)
    // keep only clearly-free licenses (drops "all rights reserved" edge cases)
    .filter((c) => /cc|public domain|pdm|cc0|fal/i.test(c.licenseShort))
    .sort((a, b) => a.index - b.index);
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
const BORING =
  /police|\bstation\b|fire station|parking|office|government|city hall|district office|hospital|clinic|\bsign\b|signage|\bmap\b|diagram|schematic|construction|scaffold|toilet|restroom|manhole|number plate|license plate|logo|\bflag\b|coat of arms|panorama of reed|\bash\b|volcanic ash|eruption|erupting|\bflood(ing|ed|s)?\b|protest|\briot\b|demonstration|funeral|\bdisaster\b|shipwreck|\bwreck\b|\bcrash\b|wildfire|\bdebris\b|rubble|demolition|aftermath|heron|egret|\bbird\b|\bduck\b|pigeon|sparrow|wildlife|butterfly|insect|squirrel|\bcat\b|\bdog\b|self.?portrait|\bancient\b|\bbabylon\b|\bpyramid|waterfall|\bcave\b|grotto|grottes|\bincense\b|coliseum|colosseum|\bruins?\b|archaeolog|\b1[0-8]\d\d\b|\b19[0-4]\d\b|\bwar\b|warfare|\bmilitary\b|\bsoldier|\barmy\b|\bnavy\b|weapon|\bbattle\b|\bcombat\b|troops|\btank\b|artillery|refugee|prisoner|execution|massacre|genocide|\bbomb|air ?raid|casualt|\bmemorial\b|cemetery|\bgrave\b|tomb of/i;

export async function commonsBest(query, { mustInclude = [], used, allowPortrait = false, minWidth = 1000, crossCheck = null, minCross = 0 } = {}) {
  const cands = await commonsCandidates(query, 14);
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
      const titleLc = c.title.toLowerCase();
      const passesMust = must.length === 0 || must.some((m) => titleLc.includes(m));
      // Scenery heroes want a wide banner. For events, the RIGHT image is the
      // performer/athlete — usually a PORTRAIT — so allowPortrait relaxes the
      // aspect gate (still rejecting extreme 1:>1.8 slivers) and lets a smaller
      // (≥600px) real photo through instead of a wrong-topic city fallback.
      const landscape = !c.w || !c.h || (allowPortrait ? c.h <= c.w * 1.8 : c.w >= c.h * 0.95);
      const bigEnough = !c.w || c.w >= minWidth;
      const scenic = !BORING.test(c.title);
      return { c, overlap, rank: i, ok: passesMust && overlap >= 1 && landscape && bigEnough && scenic && (!cross || crossN >= minCross) };
    })
    .filter((s) => s.ok)
    .filter((s) => !used || !used.has(s.c.url));

  if (!eligible.length) return null;
  // Prefer Commons-assessed great photos; otherwise keep Commons' own relevance
  // order (which ranks the iconic shot first), NOT raw title-token overlap.
  eligible.sort((a, b) => (b.c.featured - a.c.featured) || (a.rank - b.rank));
  return eligible[0].c;
}
