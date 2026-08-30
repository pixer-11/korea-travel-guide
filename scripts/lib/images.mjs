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
import { eventProperName, eventProperNameVariants } from '../../src/lib/eventName.mjs';
import { commonsBest, keyToken, tokens, wikipediaLeadImage, COMMON_ANCHOR } from './commons.mjs';

// 이벤트 히어로 부착 하한 (픽서님 결정 2026-08-30: "1024까지 허용하자").
//
// ⚠️ 08-27에 이걸 600으로 낮췄다가 하루 만에 되돌린 이력이 있다. 그때 붙은
// 474~616px 사진들이 다음 날 새벽 폭 스캔에 전부 벗겨졌기 때문이다(막스 516 ·
// 셀린 616 · 어벤지드 500/474 — '태어난 다음 날 죽는' 회전문). 그래서 이 값을
// 다시 내리는 건 위험해 보이지만, **당시 진짜 원인은 1200을 어긴 게 아니라
// 격리선(UNUSABLE_WIDTH=640)을 어긴 것**이었다. scan-hero-widths는 두 선을
// 다르게 쓴다:
//     w < 640   → 격리 (사진을 벗긴다)
//     w < 1200  → 업그레이드 큐에만 등록 (사진은 그대로 두고 더 큰 걸 찾는다)
// 1024는 그 사이에 안전하게 앉는다. 벗겨지지 않고, 더 큰 사진이 나타나면
// 자동으로 교체된다(실측: jeonju 1152→3072, 08-30 새벽). 즉 회전문이 아니라
// 래칫이다. 이 불변식은 image-width.test.mjs가 지킨다 — 1024 미만으로 다시
// 내리려 하면 테스트가 막는다.
//
// 대가는 정직하게: 1024px 히어로는 Google Discover 대형카드 자격이 없다
// (1200px 필요). 사진이 아예 없는 것보다 낫다는 판단이고, 큰 사진이 생기면
// 업그레이드 큐가 자격을 되찾아 준다. 계기는 푸켓 채식축제 — 제목까지 정확한
// 무료 사진이 Flickr `_b`=1024px뿐이었고 `_k`·`_h`·`_o`는 전부 410 Gone이라,
// 1200 하한 아래서는 영원히 사진 없는 글이었다.
export const EVENT_HERO_MIN_WIDTH = 1024;
import { heroUrlOf } from './hero-url.mjs';

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
// Country/continent/major-city names must NEVER be an event's image anchor — a
// bare "vietnam" search returns war photos, "dubai" returns skyline, etc. When the
// anchor is one of these, skip the anchor-only lookup and use the event-TYPE image.
export const GEO_STOP = new Set([
  'vietnam', 'korea', 'japan', 'thailand', 'china', 'france', 'italy', 'spain', 'india',
  'indonesia', 'malaysia', 'singapore', 'taiwan', 'turkey', 'turkiye', 'philippines',
  'emirates', 'usa', 'america', 'american', 'britain', 'england', 'germany', 'spanish',
  'asia', 'asian', 'europe', 'european', 'africa', 'oceania', 'international', 'national',
  'dubai', 'abu', 'dhabi', 'hong', 'kong', 'tokyo', 'osaka', 'seoul', 'busan', 'bangkok',
  'paris', 'madrid', 'barcelona', 'rome', 'venice', 'istanbul', 'jakarta', 'manila',
  'shanghai', 'beijing', 'taipei', 'mumbai', 'delhi', 'hanoi', 'saigon', 'bali', 'monza',
]);

export async function resolveHero({ namedVenue, region, topic, place, country = 'South Korea', used, allowUnsplash = true, selfHost = false, preferTopic = false, eventMode = false, strict = false, venue = '' } = {}) {
  const reg = region || '';
  const ctry = country || 'South Korea';
  // Events: the VENUE is the second search key after the act. Seventeen live
  // events sat photoless for a week (2026-08-22) — "Formula 1 Italian Grand
  // Prix", "Vietnamese Super Cup", "Hue Festival" have no act anchor at all
  // (every word is an anchor stop-word), so the act search never even ran,
  // and nothing here knew that Autodromo Nazionale Monza, Stade de France or
  // the Hue citadel are all over Commons. Same gate as a venue guide: the
  // venue name must be in the file title/description (identity cross-check).
  // The event's PROPER NAME as a phrase, with no anchor demanded. keyToken
  // picks one word to anchor on, and for these it picks wrong or nothing:
  // "Hue Festival" → 'autumn' (the city word is excluded, 'festival' is a
  // stop-word), "Asian Games" → '' (both stop-words), "Xi'an Grand Prix
  // (Snooker)" → 'snooker'. Commons has "Festival Huế", "Para Asian Games
  // 2018", "2024 Xi'an Grand Prix" — found only when the NAME is the query
  // and every name token must appear (cross-check), not one chosen anchor.
  // Past editions are the point: the act/sport/venue is the same.
  // `via` tells the filename identity audit HOW a file was found (see
  // lib/event-file-identity.mjs) — a venue find's leftover words are a scene,
  // an act find's leftover words are another act. Callers build heroImage
  // from explicit fields, so the tag never reaches frontmatter.
  const via = (img, how) => (img ? { ...img, via: how } : img);
  const tryProperPhrase = async () => {
    if (!eventMode || !namedVenue) return null;
    const proper = eventProperName(namedVenue);
    const toks = tokens(proper).filter((t) => !/^(19|20)\d{2}$/.test(t));
    if (!toks.length) return null;
    // Every name word for a short name, all but one for a long one. "2 of 3"
    // let "Vietnamese Super Cup" match the German handball Super Cup four
    // times over (2026-08-22); "Formula 1 Spanish Grand Prix" (4 tokens)
    // still matches "Spanish Grand Prix".
    const minCross = toks.length <= 3 ? toks.length : toks.length - 1;
    const popts = { used, allowPortrait: true, minWidth: EVENT_HERO_MIN_WIDTH, event: true, crossCheck: toks, minCross };
    return via((await commonsBest(proper, popts)) || (await commonsBest(`${proper} ${reg}`, popts)), 'phrase');
  };
  const tryVenue = async () => {
    if (!eventMode || !venue) return null;
    const va = keyToken(venue, `${reg} ${ctry}`);
    if (!va) return null;
    const vopts = { mustInclude: [va], used, allowPortrait: true, minWidth: EVENT_HERO_MIN_WIDTH, crossCheck: tokens(`${venue} ${reg}`), minCross: 2 };
    return via((await commonsBest(`${venue} ${reg}`, vopts)) || (await commonsBest(venue, { ...vopts, minCross: 1 })), 'venue');
  };

  // TOP PRIORITY for venue posts: the venue's OWN Google Places photo, self-hosted.
  // It's the real place — the most fitting image possible — and permanent once saved.
  if (selfHost && place?.photos?.length) {
    const hosted = await selfHostPlacePhoto(place, { used });
    if (hosted) return hosted;
  }

  // ICONIC-FIRST for real places (non-events): the place's Wikipedia article
  // lead image — editors already picked the most representative real photo
  // (e.g. Amalfi Coast → the classic coastal vista, not a niche watchtower).
  // Small venues (cafes etc.) have no article → null → normal flow continues.
  if (namedVenue && !eventMode) {
    // Pass the coordinates: this is the FIRST hero source tried, and without them
    // it was also the only one that could return a photo of a same-named place in
    // another country.
    const lead = await wikipediaLeadImage(namedVenue, {
      used,
      near: place?.lat && place?.lng ? { lat: place.lat, lng: place.lng } : null,
    });
    if (lead) return mark(lead, used);
  }

  // For events, the post's own city/country in the name is the WHERE, not
  // the act — never the anchor ("Dubai Summer Surprises" → "surprises", not
  // "dubai"). Venue posts keep the plain call: "Dubai Mall" IS the place.
  const anchorExclude = eventMode ? `${region || ''} ${country || ''}` : '';
  if (namedVenue && keyToken(namedVenue, anchorExclude)) {
    const anchor = keyToken(namedVenue, anchorExclude);
    // (anchor guaranteed non-empty by the guard above; an all-stop-word name like
    // "Italian Grand Prix" yields '' and skips straight to the event-type image.)
    // Events: the ideal hero is the performer/athlete, usually a portrait — allow
    // it rather than dropping to a wrong-topic city shot (width floor: EVENT_HERO_MIN_WIDTH).
    const copts = eventMode ? { allowPortrait: true, minWidth: EVENT_HERO_MIN_WIDTH, event: true } : {};
    // VENUE posts (non-event): a single shared token is NOT evidence the photo is
    // of this venue — "Art House Cafe"→"Art Picture House (UK)", "Into the
    // Forest"→a forest painting both passed that way. Require the image title to
    // share ≥2 tokens with venue-name+region, so only a genuinely-matching file
    // ("Steki" alone can't pass without "Fujairah") is ever accepted.
    const venueGuard = eventMode ? {} : { crossCheck: tokens(`${namedVenue} ${reg}`), minCross: 2 };
    // The name-and-coordinates tests. Without these the hero search accepts a
    // photo taken FROM the landmark, and a same-named place anywhere on earth:
    // a "Secret Lagoon" post about El Nido was headed by a lagoon in Batanes,
    // 1,000km north. Events are excluded — a performer's photo is correctly
    // taken somewhere other than the venue, and often has no coordinates.
    const identity = eventMode ? {} : {
      subject: namedVenue,
      near: place?.lat && place?.lng ? { lat: place.lat, lng: place.lng } : null,
    };
    // Full name (+region, then bare), then an anchor-ONLY search that finds the real
    // performer/athlete ("Ankalaev") BUT is cross-checked: the image title must
    // share ≥2 tokens with the event name, so "Magomed Ankalaev at UFC Fight Night"
    // (ankalaev+ufc+fight+night) passes while a bare "david"→statue / "sonic"→game /
    // "83rd"→army-division photo (1 token) is rejected → falls to the event-TYPE image.
    // For an EVENT, between the full title and the bare anchor sits the query
    // that actually works: the PROPER NAME. Checked against the Commons search
    // API on 2026-08-07 —
    //   "Post Malone – BIG ASS World Tour"  → a 1921 city directory
    //   anchor "malone"                     → Malone, New York (a road)
    //   "Post Malone"                       → Post Malone on stage
    //   "EuroVolley Women"                  → CEV EuroVolley match photography
    //   "BWF World Championships"           → 2018 BWF World Championships
    // Every quarantined event tested had usable imagery one query away. Without
    // this step the resolver fell through to a generic Unsplash stock photo,
    // the vision gate (correctly) refused it, and the post stayed unpublished.
    const properName = eventMode ? eventProperName(namedVenue) : '';
    // Camel-split variant ("LeeHi" → "Lee Hi") tried AFTER the stored spelling:
    // Commons search does not bridge the two spacings on its own (2026-08-09).
    const tryProperVariants = async () => {
      for (const v of eventMode ? eventProperNameVariants(namedVenue) : []) {
        if (v.toLowerCase() === String(namedVenue).toLowerCase()) continue;
        const hit = await commonsBest(v, { mustInclude: [anchor], used, ...copts, crossCheck: tokens(`${namedVenue} ${v}`), minCross: 1 });
        if (hit) return hit;
      }
      return null;
    };
    // EVENTS: the proper-name phrase goes FIRST. It is the stricter key
    // (every name word must appear) and the anchor search below is where the
    // junk comes from — "Hue Festival" anchors on 'autumn' and the resolver
    // handed the patrol six "Autumn Music" leaf photos while "Festival Huế"
    // sat one query away, never reached because the patrol's candidate loop
    // ran out of turns on the junk (2026-08-22).
    const byPhraseFirst = await tryProperPhrase();
    if (byPhraseFirst) return mark(byPhraseFirst, used);
    // A COMMON-word anchor ("super" for Vietnamese Super Cup, "moon" for the
    // Sun Moon Lake fireworks) is the event's weakest key: it surfaces other
    // Super Cups and other moons, turn after turn, and the patrol's loop never
    // reached the venue search that had Hàng Đẫy Stadium on its first try
    // (2026-08-23). The venue outranks such an anchor; a proper-noun anchor
    // (plk, bts, babymonster) still outranks the venue.
    let venueTried = false;
    if (eventMode && COMMON_ANCHOR.test(anchor)) {
      venueTried = true;
      const byVenueFirst = await tryVenue();
      if (byVenueFirst) return mark(byVenueFirst, used);
    }
    const byName =
      (await commonsBest(`${namedVenue} ${reg}`, { mustInclude: [anchor], used, ...copts, ...venueGuard, ...identity })) ||
      (await commonsBest(namedVenue, { mustInclude: [anchor], used, ...copts, ...venueGuard, ...identity })) ||
      (await tryProperVariants()) ||
      // Then just the act: "Harry Styles Residency" is not a thing anyone
      // filed a photo under, "Harry Styles" is. Two words is the shape of an
      // artist's name and of most tournaments' short form.
      (eventMode && properName.split(' ').length > 2
        ? await commonsBest(properName.split(' ').slice(0, 2).join(' '), { mustInclude: [anchor], used, ...copts, crossCheck: tokens(namedVenue), minCross: 1 })
        : null) ||
      // Anchor + the event's TYPE word, before the bare anchor. A lone short
      // anchor is what Commons search does worst with: "bigbang" → the cosmic
      // microwave background, "super" (Super Cup) → a Super Famicom, "moon"
      // (Sun Moon Lake fireworks) → a full moon, "surprises" → Surprise,
      // Nebraska (probe of the 20 photoless live events, 2026-08-16). The
      // same anchor with its type attached — "bigbang concert", "moon
      // fireworks", "super football" — lands on the act or the event, and
      // costs no vision call on the wrong-planet candidates the bare word
      // surfaces. mustInclude still pins the anchor, so a generic
      // "concert" photo without the act's name cannot slip through.
      (eventMode && anchor && !new Set(tokens(reg || '')).has(anchor) && !GEO_STOP.has(anchor)
        ? await commonsBest(`${anchor} ${eventTopic(namedVenue).split(' ')[0]}`, { mustInclude: [anchor], used, ...copts, crossCheck: tokens(namedVenue), minCross: 1 })
        : null) ||
      (eventMode && anchor.length >= 4 && !new Set(tokens(reg || '')).has(anchor) && !GEO_STOP.has(anchor)
        ? await commonsBest(anchor, { mustInclude: [anchor], used, ...copts, crossCheck: tokens(namedVenue), minCross: 2 })
        : null);
    if (byName) return mark(via(byName, 'act'), used);
    const byVenue = venueTried ? null : await tryVenue();
    if (byVenue) return mark(byVenue, used);

    // STRICT mode (venue posts at generation time): accuracy policy is
    // "real/verified venue photo or DON'T write about this venue". City-level or
    // topic imagery on a venue post is a mismatch by definition — the generator
    // must pick a different, photo-verifiable venue instead (user directive
    // 2026-07-25: never publish a wrong photo, never publish photoless).
    if (strict) return null;

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

  // Strict venue mode never falls through to topic/city/stock imagery — that IS
  // the mismatch class we're banning. (Also covers venue names with no usable
  // anchor token, which skip the block above entirely.)
  // An event whose name is all stop-words skipped the block above — the venue
  // is the only specific key it has, and it must run before the type fallback.
  const byPhraseOnly = await tryProperPhrase();
  if (byPhraseOnly) return mark(byPhraseOnly, used);
  const byVenueOnly = await tryVenue();
  if (byVenueOnly) return mark(byVenueOnly, used);
  if (strict) return null;

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
  if (/sumo|basho/.test(s)) return 'sumo wrestling tournament';
  if (/snooker|billiards/.test(s)) return 'snooker tournament table';
  // Before the generic /festival/ line — a FIREWORKS festival is not a stage.
  if (/firework/.test(s)) return 'fireworks festival display';
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
    // The hero, read the same way validate-content reads it — see hero-url.mjs.
    // A regex here missed folded scalars and posts whose officialLink sits above
    // heroImage, leaving ~113 heroes unclaimed and letting two snooker posts
    // share one photo (2026-08-19).
    const u = heroUrlOf(await readFile(join(postsDir, f), 'utf8'));
    if (!u) continue;
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
  // `via` (how the file was found) rides along for the filename identity
  // audit; the patrol and the discoverer copy the four schema fields out by
  // name, so it stops here. Stripped by mistake on the first run (2026-08-22)
  // and every venue find was refused again.
  return { url: img.url, credit: img.credit, license: img.license, source: img.source, ...(img.via ? { via: img.via } : {}) };
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
  // If EVERY candidate is already on another post, return nothing rather than
  // knowingly shipping a duplicate — the caller then falls through to the next
  // query. Two posts sharing a photo is a hard "no" for a travel guide, so a
  // fallback that silently duplicated (`|| cands[0]`) was worse than no image.
  const pick = cands.find(free);
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
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` } });
  } catch {
    return []; // transient network/DNS error must not abort the whole run (commonsCandidates already guards this way)
  }
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
