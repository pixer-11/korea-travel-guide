// Wikimedia Commons image search.
// Returns ACCURATE, freely-licensed (CC / public-domain) photos of a named
// place. Unlike stock search, a query for "Gyeongbokgung Palace" returns actual
// photos OF Gyeongbokgung — not a random palace. URLs on upload.wikimedia.org
// are content-addressed and permanent, so they're safe to hotlink from a static
// site. CC-BY/BY-SA require attribution, which we render under the image.
import { politeFetch } from './polite-fetch.mjs';
import { isUsedImage } from './hero-url.mjs';

const UA =
  'WanderAtlas/1.0 (https://wanderatlasguides.com; contact via site)';
// Commons throttles bursts with 429; a throttle window must not read as "no
// photo" (it did — see polite-fetch.mjs). Three tries, short backoff.
const cfetch = (url) => politeFetch(url, { headers: { 'User-Agent': UA }, tries: 3, baseMs: 2500 });

const stripHtml = (s = '') =>
  String(s).replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();

/**
 * The Commons API appends its own campaign query to every image URL it returns:
 *   …/1920px-Foo.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo…
 * Stored verbatim, that tail reaches the reader's browser — where content
 * blockers see utm_source/utm_campaign/utm_content and cancel the request. The
 * server answers 200 to curl and the reader still gets an empty frame, which is
 * why this hid for so long: 477 of 860 guides had a blocked hero on 2026-08-10,
 * and only body photos (which never carried the tail) still loaded.
 *
 * It was found once before, on 2026-08-04, and repaired in 24 posts by
 * scripts/normalize-wikimedia-heroes.mjs — but the SOURCE kept re-adding it, so
 * 24 became 477 in six days. That is the reason this lives here, at the one
 * place every Commons URL enters the codebase, rather than in another sweeper.
 * Wikimedia serves the identical file without the query.
 */
export const cleanCommonsUrl = (u) =>
  String(u ?? '')
    .replace(/\?utm_source=commons\.wikimedia\.org(?:&utm_[a-z]+=[A-Za-z0-9_.-]*)*/g, '')
    // Since 2026-08-31 the API hands back thumbnails on thumb.wikimedia.org.
    // Every host check downstream — identity, width ladder, normaliser, probe —
    // knew only upload.wikimedia.org, so a photo on the new host slid past the
    // Commons metadata gate as "not a Commons file" (7 live heroes by 09-02).
    // upload.wikimedia.org serves the identical thumb path, so the host is
    // folded here, at the same single entry point that strips the tracking
    // query, rather than taught to each of the four checks separately.
    .replace(/^https:\/\/thumb\.wikimedia\.org\//, 'https://upload.wikimedia.org/');

// Every word of a string, accents folded and punctuation split out — the
// same normalisation tokens() does, minus the length filter. Words of 1-2
// characters are noise as search anchors (why tokens() drops them) but they
// are identity inside a hyphenated name: "U-Know" is not "know".
export const allWords = (s = '') =>
  String(s)
    // Fold accents BEFORE stripping non-ASCII, else "Tiësto" splits into
    // "ti" + "sto" and neither is the act (2026-08-15).
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

export const tokens = (s = '') => allWords(s).filter((w) => w.length > 2);

// Generic event/tour words that must NOT become the image anchor — otherwise
// "Post Malone…" anchors on "post" and "UFC Fight Night…" on "fight", matching
// unrelated photos. Skipping them keeps the anchor on the distinctive proper noun
// (the act's name), so a concert hero only matches when it's actually that act.
export const ANCHOR_STOP = new Set([
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
  // Months — "SEPTEMBER Grand Sumo Tournament" anchored on "september" and the
  // candidates were a tightrope walker, a school choir and a ribbon-cutting:
  // September things, none of them sumo. A month is a date, never the act.
  'january', 'february', 'march', 'april', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
]);

// A COMMON word that keyToken ends up choosing as an event's anchor (forever,
// football, super, moon, autumn…). It is the weakest key an event has — worse
// than its venue — and never identity on its own (2026-08-16 "After Forever",
// 2026-08-22 "Vietnamese Super Cup" → twelve German handball Super Cups).
export const COMMON_ANCHOR = /^(forever|football|soccer|super|moon|open|autumn|spring|summer|winter|snooker|festival|fest|cup|final|live|show|night|day|street|park|city|world|music|art|food|film|beer|wine|light|fire|water|sea|lake|river|hill|mountain|garden|market)$/;

// Most distinctive word of a name — e.g. "Gyeongbokgung Palace" -> "gyeongbokgung",
// "Post Malone – Big Ass World Tour" -> "malone", "UFC Fight Night …" -> "ufc".
export const keyToken = (s = '', exclude = '') => {
  const all = tokens(s); // already length > 2
  const ordinal = (w) => /^\d+(st|nd|rd|th)$/i.test(w); // "83rd" must not anchor
  const yearLike = (w) => /^(19|20)\d{2}$/.test(w); // "2026" must not anchor either
  // Optional: words that name the WHERE, not the WHAT. An event's own city
  // in its name ("Dubai Summer Surprises", "Hue Festival") is the least
  // distinctive word in it — anchoring there searched Commons for the city
  // and found skyline photos of nothing in particular. Callers that know the
  // post's region/country pass them here; every other caller is unchanged.
  const excl = new Set(tokens(exclude));
  const bad = (w) => ANCHOR_STOP.has(w) || ordinal(w) || yearLike(w) || excl.has(w);
  // The act's name is almost always the FIRST word, and K-pop acts are short:
  // "BTS World Tour – Arlington" anchored on "arlington" (tokens() drops
  // ≤2-char words and the >3 preference skipped "bts"), "F4 … Meteor Garden"
  // on "meteor", "PLK Stade de France" on "stade", "U-Know … Yunho" on
  // "know". Thirteen of the 33 photoless event posts on 2026-08-15 were this
  // one defect — searching Commons for the venue or tour name instead of the
  // act, and finding nothing, while "BTS concert" returns CC Wembley photos.
  // So: a short (2-3 char) leading word that is not a stop-word anchors,
  // ahead of the length>3 preference. Only the FIRST word gets this
  // exemption — "Live at F1" must not anchor on "f1".
  // Accents fold first ("Tiësto" → "tiesto", not "ti"), and a hyphenated
  // lead word is one name ("U-Know" → "u-know", not "know").
  const folded = String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const leadRaw = folded.match(/^[^a-z0-9]*([a-z0-9]+(?:-[a-z0-9]+)*)/)?.[1] || '';
  const leadCore = leadRaw.replace(/-/g, '');
  if (leadRaw.includes('-') && leadCore.length >= 3 && !bad(leadCore)) return leadRaw;
  const lead = leadCore.length >= 2 && leadCore.length <= 3 ? leadCore : '';
  if (lead && !bad(lead) && !/^(an?|of|in|at|to|on|by|de|la|el|le|il|un|le|the)$/.test(lead)) return lead;
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
// Connectives carry no identity — "Gran Premio DE Aragón" is not more specific
// for containing "de", and requiring it rejected every real photo of the race.
const NAME_STOP = new Set(['de', 'del', 'la', 'las', 'los', 'the', 'of', 'and', 'el', 'le', 'les', 'da', 'do', 'di']);
const namesSubjectNotVantage = (title, subject) => {
  const words = String(subject || '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
  if (!words.length) return true;
  const hay = title.toLowerCase();
  const haystack = (hay.match(/[\p{L}\p{N}]{2,}/gu) || []).map(stem);

  // Short names must match whole: "Cloud Gate" with one word missing is a
  // different place. Long EVENT-style names ("MotoGP Gran Premio de Aragón")
  // must not: Commons files say "Gran Premio de Aragón 2019" or "MotoGP Aragon"
  // — never the full ceremonial title — and the all-words rule sent the owner a
  // two-slide set for a race with hundreds of free photos. 60% of the
  // distinctive words is enough to be talking about the same thing.
  const sig = [...new Set(words.filter((w) => !NAME_STOP.has(w)).map(stem))];
  const matched = sig.filter((w) => haystack.includes(w)).length;
  const needed = sig.length <= 2 ? sig.length : Math.ceil(sig.length * 0.6);
  if (matched < needed) return false;

  // A viewpoint inverts the vantage rule: "View from Khao Rang" is not a
  // mis-captioned photo of something else, it is the subject itself — the
  // panorama is what visitors climb up for. Without this, every correctly
  // titled photo of a viewpoint's view was filtered before vision ever saw it.
  if (/\b(viewpoint|view\s?point|overlook|observation|lookout|skywalk)\b/i.test(subject)) return true;

  // Where the subject is first mentioned; everything before it decides whether
  // the photo is OF the place or merely taken FROM it.
  const first = words[0];
  const at = hay.search(new RegExp('\\b' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  return !SHOT_FROM_NOT_OF.test(title.slice(0, at < 0 ? 0 : at));
};

const UNUSABLE_SUBJECT =
  // Stamps, coins, medals, tickets, emblems, mascots, maps: Commons is full of
  // them for any big event ("Stamp of Indonesia … 2018 Asian Games" was three
  // of the four Asian Games results, 2026-08-22) and none is ever a hero.
  /\b(?:construction|scaffold|scaffolding|crane|renovation|restoration|demolition|closed|closure|notice|signboard|plaque|placard|floor\s?plan|diagram|blueprint|schematic|logo|poster|screenshot|stamp|stamps|coin|coins|medal|medals|ticket|tickets|emblem|mascot|banknote|postcard|map|maps)\b/i;

// Why a file name disqualifies a photo, or '' if it does not. Exported so the
// hero audit applies the same test the carousel does — the Cloud Gate guide
// failed both places at once, and fixing one would have left the other.
// A file whose NAME dates it 15+ years back is an archive shot. Fine for a
// castle; wrong for an event guide — a 1986 paddock photo headed the 2026
// Misano MotoGP page, a 2004 Ferrari the Monza one (owner, 2026-08-15).
// The Commons width prefix ("1920px-") is stripped first so it can't read
// as a year, and the check is exported so callers that know they are
// choosing for an EVENT can apply it; venue posts are left alone.
const ARCHIVE_YEARS = 15;
export function archiveYearProblem(fileName, now = new Date().getFullYear()) {
  const bare = String(fileName).replace(/^\d+px-/, '');
  const m = bare.match(/(?<![0-9])(18[0-9]{2}|19[0-9]{2}|20[0-9]{2})(?![0-9])/);
  return m && now - Number(m[1]) >= ARCHIVE_YEARS ? `archive-${m[1]}` : '';
}

export function heroTitleProblem(fileName, subject, { event = false } = {}) {
  if (UNUSABLE_SUBJECT.test(fileName)) return 'unusable';   // construction, signage, plans
  if (event) { const a = archiveYearProblem(fileName); if (a) return a; }
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
      const r = await cfetch(url);
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
        url: cleanCommonsUrl(ii.thumburl || ii.url),
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
export async function wikipediaLeadImage(name, { used, minWidth = 1200, near = null } = {}) {
  if (!name) return null;
  // '|' is MediaWiki's MULTI-TITLE separator: "Earth House | Restaurant |
  // Wine Bar" queried the generic 'Restaurant' and 'Wine bar' articles and a
  // Bangkok post shipped a Washington D.C. hotel restaurant as its hero
  // (found live 2026-08-10, reproduced byte-for-byte). The any-token redirect
  // check passed because 'restaurant' IS a query token, and generic articles
  // carry no coordinates so the geo guard silently skipped. A pipe never
  // belongs in a single venue lookup — refuse and let commonsBest handle it.
  if (String(name).includes('|')) return null;
  const wikiUrl =
    'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1' +
    '&titles=' + encodeURIComponent(name) +
    '&prop=pageimages|pageprops|coordinates&piprop=name&ppprop=disambiguation';
  let page;
  try {
    const res = await cfetch(wikiUrl);
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
  // Same archival guard as commonsBest — underscores defeat BORING's \b
  // anchors ('Comiket_Special_1978.jpg' passed), and a lead image can be a
  // century-old engraving as easily as a search hit can.
  if (/(18|19)\d{2}/.test(String(page.pageimage).replace(/[_-]+/g, ' '))) return null;
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
    const res = await cfetch(fileUrl);
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
  const url = cleanCommonsUrl(ii.thumburl || ii.url);
  if (!url || isUsedImage(used, url)) return null;
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

// minWidth 1200: Google Discover only serves large image cards from photos at
// least 1200px wide, and the hero doubles as og:image — a narrower pick costs
// the page Discover distribution. Events share the same 1200 floor since
// 2026-08-28 — the old 600 override is what fed the attach-then-strip churn.
// Commons file names glue a name together where our title spaces it out
// ("LeeHi 2019" for our "Lee Hi") and space it out where our title glues it.
// So the anchor guard compares with every space, underscore and hyphen removed
// from both sides — without that, an artist whose romanisation is spaced
// differently had 5+ CC concert photos on Commons and the event stayed
// photoless (2026-08-09).
//
// The trap in that comparison is what the removal lets a name straddle. As a
// plain substring test over the flattened title, the anchor "u-know" flattens
// to "uknow" and "Do yo|u know?" flattens to "doyouknow" — which contains it.
// The U-KNOW post's candidate search came back with sixteen consecutive scanned
// pages of an old book ("Do you know? - DPLA - …"), burned the whole refusal
// budget on them, and was then correctly judged a dead search and abandoned
// (2026-08-30). Vision cannot tell acts apart, so a file like that has to be
// stopped by the search, not by the gate behind it.
//
// So the match must respect where words begin. It may sit entirely INSIDE one
// word — Commons is full of glued file names, and "FranceNormandieLeMont-
// SaintMichelAbbaye" is how the Mont-Saint-Michel hero is spelled — or it may
// span several words as long as it STARTS where a word starts ("Hazrat imam"
// is the only spelling that satisfies the anchor "hazrati", and that too is a
// live hero). The one thing it may no longer do is begin in the middle of one
// word and run into the next. Measured over all 854 live Wikimedia heroes:
// none of them loses its match.
const respace = (s) => String(s).toLowerCase().replace(/[\s_-]+/g, '');

export function containsRespaced(text, needle) {
  const need = respace(needle);
  if (!need) return false;
  const words = String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  // Inside a single word.
  if (words.some((w) => w.includes(need))) return true;
  // Or across whole words, starting where one begins.
  for (let i = 0; i < words.length; i++) {
    let run = '';
    for (let j = i; j < words.length; j++) {
      run += words[j];
      if (run.startsWith(need)) return true;
      if (run.length >= need.length) break;
    }
  }
  return false;
}

export async function commonsBest(query, { mustInclude = [], used, allowPortrait = false, minWidth = 1200, crossCheck = null, minCross = 0, subject = '', near = null, event = false } = {}) {
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
      // Space-insensitive on BOTH sides: a K-pop act stored as "LeeHi" must
      // match Commons files named "Lee Hi …" (and vice versa). Without this
      // the anchor guard rejected every real photo of an artist whose romanized
      // name is spaced differently than our title (found 2026-08-09 — Lee Hi
      // had 5+ CC concert photos on Commons and the event stayed photoless).
      const passesMust = must.length === 0 ||
        must.some((m) => titleLc.includes(m) || containsRespaced(titleLc, m));
      // Scenery heroes want a wide banner. For events, the RIGHT image is the
      // performer/athlete — usually a PORTRAIT — so allowPortrait relaxes the
      // aspect gate (still rejecting extreme 1:>1.8 slivers) and lets a real
      // portrait through instead of a wrong-topic city fallback. Width is NOT
      // relaxed: the caller's 1200 floor applies (600 caused the 08-28 churn).
      const landscape = !c.w || !c.h || (allowPortrait ? c.h <= c.w * 1.8 : c.w >= c.h * 0.95);
      const bigEnough = !c.w || c.w >= minWidth;
      // A 19xx/18xx year in the FILE TITLE marks an archival photo. The event
      // path picked "Comiket_Special_1978.jpg" — genuinely Comiket, correctly
      // identity-matched, half a century stale — as a 2026 event hero
      // (2026-08-09; the region-cover backfill hit the same class twice the
      // same day). Historical photos are wrong for venue tiles too.
      // Events get the stricter 15-year rule on top: "Fale_F1_Monza_2004",
      // "Tomatina_2006", a 1986 Misano paddock — genuinely the event,
      // decades stale for a 2026 guide (owner, 2026-08-15). Venue tiles keep
      // the 18xx/19xx rule alone; a castle photographed in 2004 is fine.
      const archival = /(18|19)\d{2}/.test(c.title) || (event && !!archiveYearProblem(c.title));
      const scenic = !BORING.test(c.title);
      return { c, overlap, rank: i, ok: passesMust && overlap >= 1 && landscape && bigEnough && scenic && !archival && (!cross || crossN >= minCross || foreignN === 0) };
    })
    .filter((s) => s.ok)
    // By photo, not by string: a file another post wears at a different width
    // or host is taken (2026-09-03, two tour cities in one portrait).
    .filter((s) => !isUsedImage(used, s.c.url));

  if (!eligible.length) return null;
  // Prefer Commons-assessed great photos; otherwise keep Commons' own relevance
  // order (which ranks the iconic shot first), NOT raw title-token overlap.
  eligible.sort((a, b) => (b.c.featured - a.c.featured) || (a.rank - b.rank));
  return eligible[0].c;
}
