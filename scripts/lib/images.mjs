// Picks ONE legally-usable hero image for a post, in priority order:
//   1. A Google Places photo of the actual venue (best — it's the real place)
//   2. An Unsplash photo matching the query (openly licensed)
//   3. Our own placeholder SVG (always safe)
// Every returned image carries a license tag that guardrails will re-check.
import { writeFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlacePhoto, fetchPlacePhotoBytes } from './places.mjs';
import { commonsBest, keyToken, tokens } from './commons.mjs';

const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;

// Where self-hosted venue photos live (served by Cloudflare from /venue-photos/).
const VENUE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'venue-photos');
const extFor = (ct) => (ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg');

// Download + self-host the ACTUAL Google Places photo of a venue. Google's photo
// URLs are short-lived, so we save the bytes locally → a permanent, real photo of
// the place. Tries the first few photos until one downloads. Returns a hero object
// with a LOCAL url, or null if none worked (caller then falls back to Commons/Unsplash).
export async function selfHostPlacePhoto(place, { maxWidth = 1600, used } = {}) {
  const photos = place?.photos ?? [];
  for (let i = 0; i < Math.min(photos.length, 3); i++) {
    let data;
    try { data = await fetchPlacePhotoBytes(photos[i], { maxWidth }); } catch { continue; }
    if (!data?.buf) continue;
    const hash = createHash('sha1').update(`${place.id}|${photos[i].name || i}`).digest('hex').slice(0, 16);
    const file = `${hash}.${extFor(data.contentType)}`;
    const url = `/venue-photos/${file}`;
    if (used && used.has(url)) continue;
    if (!existsSync(VENUE_DIR)) await mkdir(VENUE_DIR, { recursive: true });
    await writeFile(join(VENUE_DIR, file), data.buf);
    if (used) used.add(url);
    return { url, credit: data.credit, license: 'google-places', source: data.source };
  }
  return null;
}

const PLACEHOLDER = {
  url: '/images/placeholder-market.svg',
  credit: 'Placeholder image',
  license: 'placeholder',
  source: 'local',
};

export async function pickImage(place, fallbackQuery) {
  // 1. Real venue photo via Places.
  if (place?.photos?.length) {
    try {
      const img = await getPlacePhoto(place.photos[0]);
      if (img?.url) return img;
    } catch { /* fall through */ }
  }

  // 2. Unsplash (openly licensed) as a topical fallback.
  if (UNSPLASH_KEY && fallbackQuery) {
    try {
      const img = await searchUnsplash(fallbackQuery);
      if (img) return img;
    } catch { /* fall through */ }
  }

  // 3. Always-safe placeholder.
  return PLACEHOLDER;
}

// Grab up to `n` additional venue photos for an in-body gallery.
// Skips the first photo (already used as hero) to avoid duplication.
export async function pickGallery(place, n = 3) {
  const out = [];
  const photos = place?.photos ?? [];
  for (let i = 1; i < photos.length && out.length < n; i++) {
    try {
      const img = await getPlacePhoto(photos[i]);
      if (img?.url) out.push(img);
    } catch { /* skip */ }
  }
  return out;
}

// ── Accurate-first hero resolver ─────────────────────────────
// Priority is ACCURACY, not just "a nice photo":
//   1. Wikimedia Commons by the real venue name  → actual photo of THIS place
//   2. Google Places photo of the venue          → actual photo (may be short-lived)
//   3. Wikimedia Commons by topic + region       → right place & country
//   4. Unsplash, strictly constrained to region + "South Korea", BEST (not random)
//   5. Placeholder
// `used` is an optional Set of URLs already taken by other posts (de-dupe).
export async function resolveHero({ namedVenue, region, topic, place, country = 'South Korea', used, allowUnsplash = true, selfHost = false, preferTopic = false, eventMode = false } = {}) {
  const reg = region || '';
  const ctry = country || 'South Korea';

  // TOP PRIORITY for venue posts: the venue's OWN Google Places photo, self-hosted.
  // It's the real place — the most fitting image possible — and permanent once saved.
  if (selfHost && place?.photos?.length) {
    const hosted = await selfHostPlacePhoto(place, { used });
    if (hosted) return hosted;
  }

  if (namedVenue) {
    const anchor = keyToken(namedVenue);
    // Events: the ideal hero is the performer/athlete, usually a portrait — allow
    // it (and a smaller ≥600px file) rather than dropping to a wrong-topic city shot.
    const copts = eventMode ? { allowPortrait: true, minWidth: 600 } : {};
    const byName =
      (await commonsBest(`${namedVenue} ${reg}`, { mustInclude: [anchor], used, ...copts })) ||
      (await commonsBest(namedVenue, { mustInclude: [anchor], used, ...copts })) ||
      // Events: the full title ("UFC Fight Night: Ankalaev vs Rountree Jr …") is
      // too specific for Commons search; the distinctive name alone ("Ankalaev")
      // finds the actual performer/athlete. Skip when the anchor is just the city
      // (e.g. "Hong Kong Football" → "hong") — that returns a cityscape, not the
      // event; let it fall through to the event-TYPE image instead. ≥4 chars.
      (eventMode && anchor.length >= 4 && !new Set(tokens(reg || '')).has(anchor)
        ? await commonsBest(anchor, { mustInclude: [anchor], used, ...copts })
        : null);
    if (byName) return mark(byName, used);

    // Google Places photos ARE the actual venue, but the returned photoUri
    // EXPIRES within hours — unusable on a static site unless self-hosted.
    // Off by default; the Wikimedia/Unsplash URLs below are permanent.
    if (process.env.USE_PLACES_PHOTO === '1' && place?.photos?.length) {
      try {
        const img = await getPlacePhoto(place.photos[0]);
        if (img?.url && (!used || !used.has(img.url))) return mark(img, used);
      } catch { /* fall through */ }
    }
  }

  // The topic itself may be a place name (e.g. "Nami Island", "Abai Village",
  // "Aewol"). Try Commons by topic-as-name — but skip generic topic words so
  // "local restaurant" can't match some random file containing "local".
  if (!namedVenue && topic) {
    const anchor = keyToken(topic);
    const GENERIC = new Set([
      'local', 'trendy', 'hidden', 'street', 'best', 'top', 'cafe', 'cafes',
      'restaurant', 'food', 'popular', 'famous', 'black', 'sight', 'sightseeing',
      'nature', 'history', 'coffee', 'seafood',
    ]);
    if (anchor && anchor.length > 3 && !GENERIC.has(anchor)) {
      const byTopicName =
        (await commonsBest(`${topic} ${reg}`, { mustInclude: [anchor], used })) ||
        (await commonsBest(topic, { mustInclude: [anchor], used }));
      if (byTopicName) return mark(byTopicName, used);
    }
  }

  const topicQ = [topic, reg, ctry].filter(Boolean).join(' ');
  const byTopic = await commonsBest(topicQ, { mustInclude: [reg].filter(Boolean), used });
  if (byTopic) return mark(byTopic, used);

  if (allowUnsplash) {
    // Specific → region-level → country-level. Over-specific queries often
    // return nothing; broadening guarantees a country-accurate photo, never a
    // wrong-country one, and never a blank placeholder.
    // For events, prefer an ON-TOPIC image (the event TYPE — "road cycling race",
    // "mixed martial arts"…) over a generic city/landscape when the region-scoped
    // query finds nothing. preferTopic puts the type query ahead of the city one.
    const u =
      (await unsplashStrict([reg, ctry, topic].filter(Boolean).join(' '), used)) ||
      (preferTopic && topic ? await unsplashStrict(topic, used) : null) ||
      (await unsplashStrict([reg, ctry].filter(Boolean).join(' '), used)) ||
      (await unsplashStrict(`${ctry} travel landscape`, used));
    if (u) return mark(u, used);
  }

  return PLACEHOLDER;
}

// The stable identity of an Unsplash image is the numeric token in its path
// (`…/photo-1525625293386-hash?params`); the ?params vary per request, so a
// URL-only Set misses re-used photos. Track this too, and seed it from existing
// post URLs when de-duping across the whole site.
export function unsplashNum(url) {
  const m = String(url || '').match(/photo-(\d+)/);
  return m ? `unum:${m[1]}` : null;
}

// Map an event NAME to a thematic image query for its TYPE, so an event hero is
// at least on-topic (an MMA cage, a race bike, a concert stage) when we can't find
// the specific act/fighter. Order matters: specific series before generic words.
export function eventTopic(name = '') {
  const s = String(name).toLowerCase();
  if (/\bufc\b|\bmma\b|mixed martial|fight night|boxing/.test(s)) return 'mixed martial arts fight';
  if (/moto\s?gp/.test(s)) return 'motorcycle grand prix racing';
  if (/formula\s?1|formula one|\bf1\b/.test(s)) return 'formula 1 racing car';
  if (/grand prix|gran premio/.test(s)) return 'motorsport racing';
  if (/vuelta|tour de france|giro d|cyclist|cycling|\bvelo\b/.test(s)) return 'road cycling race peloton';
  if (/marathon/.test(s)) return 'marathon running race';
  if (/athletics|track and field|continental tour/.test(s)) return 'athletics stadium track';
  if (/football|soccer|\bfifa\b/.test(s)) return 'football soccer stadium';
  if (/volley/.test(s)) return 'volleyball match';
  if (/basketball|\bnba\b|\bfiba\b/.test(s)) return 'basketball game';
  if (/baseball/.test(s)) return 'baseball game';
  if (/badminton|\bbwf\b/.test(s)) return 'badminton match';
  if (/tennis|\batp\b|\bwta\b|us open|open championship/.test(s)) return 'tennis tournament';
  if (/aquatics|swimming|water polo|diving/.test(s)) return 'swimming competition pool';
  if (/miss world|miss universe|pageant/.test(s)) return 'beauty pageant stage';
  if (/film festival|cinema|\bfilm\b/.test(s)) return 'film festival cinema';
  if (/rock festival|\brock\b/.test(s)) return 'rock concert crowd';
  if (/jazz/.test(s)) return 'jazz concert';
  if (/flute|orchestra|symphony|classical|philharmon|opera/.test(s)) return 'orchestra concert stage';
  if (/rally|motorcycle/.test(s)) return 'motorcycle rally';
  if (/festival/.test(s)) return 'music festival crowd';
  if (/concert|tour|live|world tour|k-pop|kpop/.test(s)) return 'concert stage live music';
  return 'concert live event stage';
}

// Build a `used` Set from every post's current hero URL — both the full URL and
// its photo-id token — so resolveHero never hands a duplicate to a new post.
// Shared by the daily generator AND discover-events (the latter used to skip it,
// which is how concert posts ended up all sharing one city photo).
export async function loadUsedImageUrls(postsDir) {
  const used = new Set();
  for (const f of await readdir(postsDir)) {
    if (!f.endsWith('.md')) continue;
    const m = (await readFile(join(postsDir, f), 'utf8')).match(/\n {2}url:\s*"?([^"\n]+?)"?\s*$/m);
    if (!m) continue;
    const u = m[1].trim();
    used.add(u);
    const n = unsplashNum(u);
    if (n) used.add(n);
  }
  return used;
}

function mark(img, used) {
  if (used && img?.url) {
    used.add(img.url);
    const n = unsplashNum(img.url);
    if (n) used.add(n);
  }
  if (!img) return img;
  // Return ONLY the fields the post schema stores — Commons candidates carry
  // internal scoring fields (index, w, h, featured…) that must not leak into
  // frontmatter.
  return { url: img.url, credit: img.credit, license: img.license, source: img.source };
}

// Unsplash, deterministic BEST match (top of the ranked candidates), Korea-scoped.
// Never random — random top-10 picks are what produced wrong-country photos.
async function unsplashStrict(query, used) {
  const cands = await unsplashCandidates(query, 12);
  // De-dupe by Unsplash PHOTO ID, not just the full URL — the same photo can appear
  // with different query params, which slipped past a URL-only check and put one
  // photo on several posts.
  const free = (c) => {
    if (!used) return true;
    const n = unsplashNum(c.url);
    return !used.has(c.url) && !(n && used.has(n)) && !used.has(`unsplash:${c.id}`);
  };
  const pick = cands.find(free) || cands[0];
  if (!pick) return null;
  if (used) {
    used.add(pick.url);
    used.add(`unsplash:${pick.id}`);
    const n = unsplashNum(pick.url);
    if (n) used.add(n);
  }
  trackUnsplashDownload(pick.downloadLocation);
  return { url: pick.url, credit: pick.credit, license: pick.license, source: pick.source };
}

const UTM = 'utm_source=korea_travel_guide&utm_medium=referral';

// Unsplash API guideline: trigger the download endpoint when a photo is
// actually used (required to keep API access). Fire-and-forget.
export function trackUnsplashDownload(location) {
  if (location && UNSPLASH_KEY) {
    fetch(location, { headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` } }).catch(() => {});
  }
}

// Returns up to `perPage` candidate images for a query (for de-duplication).
export async function unsplashCandidates(query, perPage = 30) {
  if (!UNSPLASH_KEY) return [];
  const url =
    `https://api.unsplash.com/search/photos?per_page=${perPage}&orientation=landscape` +
    `&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results ?? []).map((hit) => ({
    id: hit.id,
    url: `${hit.urls.raw}&w=1600&q=80&fm=jpg&fit=max`, // 1600px for Discover
    credit: `Photo by ${hit.user.name} on Unsplash`,
    license: 'unsplash',
    source: `${hit.user.links.html}?${UTM}`,
    downloadLocation: hit.links?.download_location,
  }));
}

// Single-image helper for the generator. Picks a RANDOM one of the top results
// (not always the first) to reduce duplicate photos across posts.
async function searchUnsplash(query) {
  const cands = await unsplashCandidates(query, 10);
  if (!cands.length) return null;
  const pick = cands[Math.floor(Math.random() * cands.length)];
  trackUnsplashDownload(pick.downloadLocation);
  return { url: pick.url, credit: pick.credit, license: pick.license, source: pick.source };
}
