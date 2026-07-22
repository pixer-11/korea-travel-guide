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

// First distinctive word of a name, e.g. "Gyeongbokgung Palace" -> "gyeongbokgung".
export const keyToken = (s = '') => {
  const t = tokens(s).filter((w) => w.length > 3);
  return t[0] || tokens(s)[0] || '';
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
  /police|\bstation\b|fire station|parking|office|government|city hall|district office|hospital|clinic|\bsign\b|signage|\bmap\b|diagram|schematic|construction|scaffold|toilet|restroom|manhole|number plate|license plate|logo|\bflag\b|coat of arms|panorama of reed|\bash\b|volcanic ash|eruption|erupting|\bflood(ing|ed|s)?\b|protest|\briot\b|demonstration|funeral|\bdisaster\b|shipwreck|\bwreck\b|\bcrash\b|wildfire|\bdebris\b|rubble|demolition|aftermath/i;

export async function commonsBest(query, { mustInclude = [], used } = {}) {
  const cands = await commonsCandidates(query, 14);
  if (!cands.length) return null;
  const qtok = tokens(query);
  const must = mustInclude.map((s) => String(s).toLowerCase()).filter(Boolean);

  const eligible = cands
    .map((c, i) => {
      const ttok = new Set(tokens(c.title));
      const overlap = qtok.filter((t) => ttok.has(t)).length;
      const titleLc = c.title.toLowerCase();
      const passesMust = must.length === 0 || must.some((m) => titleLc.includes(m));
      const landscape = !c.w || !c.h || c.w >= c.h * 0.95; // hero is a wide banner
      const bigEnough = !c.w || c.w >= 1000;
      const scenic = !BORING.test(c.title);
      return { c, overlap, rank: i, ok: passesMust && overlap >= 1 && landscape && bigEnough && scenic };
    })
    .filter((s) => s.ok)
    .filter((s) => !used || !used.has(s.c.url));

  if (!eligible.length) return null;
  // Prefer Commons-assessed great photos; otherwise keep Commons' own relevance
  // order (which ranks the iconic shot first), NOT raw title-token overlap.
  eligible.sort((a, b) => (b.c.featured - a.c.featured) || (a.rank - b.rank));
  return eligible[0].c;
}
