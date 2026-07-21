// Wikimedia Commons image search.
// Returns ACCURATE, freely-licensed (CC / public-domain) photos of a named
// place. Unlike stock search, a query for "Gyeongbokgung Palace" returns actual
// photos OF Gyeongbokgung — not a random palace. URLs on upload.wikimedia.org
// are content-addressed and permanent, so they're safe to hotlink from a static
// site. CC-BY/BY-SA require attribution, which we render under the image.
const UA =
  'KoreaTravelGuide/1.0 (https://korea-travel-guide.pixer-vtm.workers.dev; contact via site)';

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
    '&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=1600&origin=*';

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
      const title = (p.title || '').replace(/^File:/, '').replace(/\.(jpe?g|png)$/i, '');
      return {
        title,
        index: p.index ?? 999,
        url: ii.thumburl || ii.url,
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
export async function commonsBest(query, { mustInclude = [], used } = {}) {
  const cands = await commonsCandidates(query, 12);
  if (!cands.length) return null;
  const qtok = tokens(query);
  const must = mustInclude.map((s) => String(s).toLowerCase()).filter(Boolean);

  const scored = cands
    .map((c) => {
      const ttok = new Set(tokens(c.title));
      const overlap = qtok.filter((t) => ttok.has(t)).length;
      const titleLc = c.title.toLowerCase();
      const passesMust = must.length === 0 || must.some((m) => titleLc.includes(m));
      return { c, overlap, passesMust };
    })
    .filter((s) => s.passesMust && s.overlap >= 1)
    .filter((s) => !used || !used.has(s.c.url))
    .sort((a, b) => b.overlap - a.overlap);

  return scored.length ? scored[0].c : null;
}
