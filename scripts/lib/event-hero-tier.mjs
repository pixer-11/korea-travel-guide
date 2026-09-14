// THE THIRD TIER, AS A TEST A CHECKER CAN RUN.
//
// Owner's rule, 2026-09-11: an event guide shows the act's own photo; failing
// that a past edition of the event; failing that the best photo of the city it
// is held in. fill-event-city-heroes.mjs places that third tier, and its claim
// is "a photo of this city" — which is why it deliberately does not ask the
// vision gate, whose question is "a photo of this event". A city skyline is a
// correct answer to one and a correct rejection by the other.
//
// audit-event-heroes.mjs asked only the second question and STRIPPED whatever
// failed. On 2026-09-13 that removed fifteen photographs that had been placed
// on purpose, and one of those strips reached the live site before it was
// reverted. This is the test it was missing.
//
// Venue counts too, and ranks above the city: a photograph of Qizhong Stadium
// on a Shanghai Masters guide is the place the reader is going, and it fails
// vision for the honest reason that no tennis is visible in it.
//
// WHOLE WORDS, ALL OF THEM (2026-09-14). The first version matched any single
// token as a substring of the filename, and a Codex review reproduced three
// strangers it would have kept: "Hue" inside Schuetzenfest_Berlin.jpg, "Ubud"
// inside Batu_Buddha.jpg, and "Nha Trang" on Trang_Thailand.jpg. A rule whose
// whole job is to excuse a photo from the identity check has to be the
// strictest matcher in the file, not the loosest.

const fileOf = (u) => {
  const last = String(u ?? '').split('/').pop() ?? '';
  try { return decodeURIComponent(last); } catch { return last; }
};

// Wikimedia serves the same photograph at fixed widths, so the region cover and
// the hero placed from it differ only by a "1600px-" prefix (the thumbnail
// ladder). Compare the photograph, not the size we asked for.
const baseName = (u) => fileOf(u).toLowerCase().replace(/^[0-9]+px-/, '');
const sameImage = (a, b) => !!a && !!b && baseName(a) === baseName(b);

const wordsOf = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

// Words that describe what KIND of place a venue is, not WHICH one. Without
// them "Taipei Arena" is "taipei" and "Olympic Park" is "olympic" — the part
// a photographer actually puts in a filename.
const GENERIC = new Set([
  'the', 'of', 'and', 'de', 'la', 'le', 'at',
  'arena', 'stadium', 'park', 'hall', 'center', 'centre', 'tennis', 'convention',
  'exhibition', 'international', 'trade', 'national', 'city', 'dome', 'theatre',
  'theater', 'square', 'ground', 'grounds', 'complex', 'venue', 'club', 'forum',
]);

/**
 * Does the filename name this label? Every distinctive word of the label must
 * be a whole word of the filename — or, for names a filename writes run
 * together ("Qi Zhong" → Qizhong_Stadium), their concatenation must be.
 */
function fileNames(label, fileWords) {
  const distinct = wordsOf(label).filter((w) => !GENERIC.has(w));
  if (!distinct.length) return false;
  const have = new Set(fileWords);
  if (distinct.every((w) => have.has(w))) return true;
  return distinct.length > 1 && have.has(distinct.join(''));
}

/**
 * Why this photo is allowed to stay even though it is not a photo OF the event,
 * or null when nothing justifies it.
 * @param {string} url       the hero's URL
 * @param {any} data         the post's frontmatter
 * @param {Record<string, {url?: string}>} [covers]  data/region-covers.json
 * @returns {string | null}  a human-readable reason, or null
 */
export function heroTierReason(url, data, covers = {}) {
  if (!url) return null;
  const fileWords = wordsOf(baseName(url).replace(/\.[a-z0-9]+$/, ''));

  const venue = String(data?.eventVenue ?? '').trim();
  if (venue) {
    // A venue's own acronym, written in brackets — "(BITEC)" — is the most
    // distinctive thing it has and is exactly what a filename is called.
    const acronym = venue.match(/\(([A-Za-z0-9]{3,})\)/)?.[1]?.toLowerCase();
    const withoutAcronym = venue.replace(/\([^)]*\)/g, ' ');
    if ((acronym && fileWords.includes(acronym)) || fileNames(withoutAcronym, fileWords)) {
      return `파일명이 행사장(${venue})을 가리킨다`;
    }
  }

  const region = String(data?.region ?? '').trim();
  if (!region) return null;
  if (sameImage(covers?.[region]?.url, url)) return `${region} 의 검증된 지역 커버`;
  return fileNames(region, fileWords) ? `파일명이 도시(${region})를 가리킨다` : null;
}
