// THE THIRD TIER: an event guide with no photo of its own shows its city.
//
// Owner's rule, 2026-09-11: "an act's other photos; failing that a past edition
// of the event; failing that the best photo of the city it is held in." The
// resolver already does the first two. The third had no machinery at all, and
// twelve live guides sat behind the brand card until they were filled by hand.
//
// This is deliberately NOT part of resolveHero. The claim is different: the
// resolver's candidates are answers to "a photo of this event", judged by a
// vision gate that asks exactly that — and a city skyline correctly fails it.
// Here the claim is "a photo of this city", and the test that fits is the
// filename naming the region. So the two never argue.
//
// Safety, in order:
//   1. the region's own verified cover photo (data/region-covers.json) first —
//      already fetched under the identity rules of the photo pipeline;
//   2. otherwise Commons, filename must name the region, wide, big enough, and
//      not a hero anywhere else on the site;
//   3. never a photo a person has rejected for this post;
//   4. whatever it picks lands UNREVIEWED in audit-event-hero-identity, so a
//      person reads it the next morning. Twice on 2026-09-11 that eye was the
//      only thing between the site and a building site in Tangerang.
//
//   node scripts/fill-event-city-heroes.mjs            # fill
//   node scripts/fill-event-city-heroes.mjs --dry      # say what it would do
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { commonsRanked, tokens, cleanCommonsUrl } from './lib/commons.mjs';
import { heroTierReason } from './lib/event-hero-tier.mjs';
import { loadWorld } from './lib/commons-identity.mjs';
import { identityRejection, isHandRejection, photoFamily } from './lib/photo-verdict.mjs';
import { isMeasurementFailure } from './lib/audit-verdict.mjs';
import { isUsedImage, markUsedImage } from './lib/hero-url.mjs';
import { verifyHeroImage } from './lib/vision-check.mjs';
import { REJECTS_FILE, wasRejected, rememberRejection, pruneRejections } from './lib/city-hero-rejects.mjs';

// A file that names an EVENT is that event's photo, not the city's: "Santander
// La Mezza di Torino 2017" (a half marathon) went onto the Torino City
// Marathon on 2026-10-06. The city tier is for views of the place.
import { NAMES_AN_EVENT, SCENE_WORDS, GENERIC_FILE_WORDS } from './lib/event-file-identity.mjs';

const DIR = 'src/content/posts';
const DRY = process.argv.includes('--dry');
const MIN_WIDTH = 1024;
// Vision calls one post may spend a night. Rejections are remembered for 30
// days (lib/city-hero-rejects), so the next night starts further down the list.
const VISION_PER_POST = Math.max(1, Number(process.env.CITY_VISION_PER_POST) || 4);
// Sight guides of the city to search by name, most-reviewed first.
const LANDMARKS_PER_POST = 6;
// Kinds of city scene, for a city whose skyline photos are taken already.
const SCENES = ['old town', 'mosque', 'temple', 'cathedral', 'square', 'monument', 'museum', 'river', 'lake', 'park', 'at night', 'panorama', 'landscape', 'aerial view'];
const picksIn = new Map(); // region → photos placed this run, to rotate the search order
const spentViews = new Map(); // region → view searches that already placed a photo this run
// Photographs of a place as it was (the Prokudin-Gorsky "Syr Darya Oblast. City
// of Tashkent" plates came up for a 2026 expo). The archive-year rule in
// commons only sees a year in the title, and these carry none.
// Narrow on purpose: "Giza Governorate", "colonial era buildings" and "Oblast
// Museum" are modern photos of old things (review, 11-12). The plates are
// titled "<Region> Oblast. <Place>.", and a dated archive says "circa 1910".
const HISTORICAL = /\b(prokudin|gorsky|gorskii)\b|\boblast\.\s|\b(c\.|circa)\s?1[89]\d\d\b|\bsoviet[\s-]era\b/i;

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; } };
const covers = readJson('data/region-covers.json');
const audit = readJson('data/visual-audit.json');
const rejects = readJson(REJECTS_FILE);
let rejectsChanged = pruneRejections(rejects);

// A person or a patrol has already ruled this photo out for this post.
// A person's "not this city" is about the photo and the city, not one post: a
// Florida (Buenos Aires Province) skyline rejected on one Buenos Aires event
// went straight onto the next Buenos Aires event in the same run (11-12).
// Filled in the read loop below, from EVENT posts only: a rejection on a venue
// guide ("Westhafen Tower" on the Main Tower guide) says the photo is not that
// building, not that it is not Frankfurt (Codex, 11-12).
const regionOf = new Map();
const landmarks = new Map(); // region → [{name, n}] from the site's own sight guides
const handRejectedInRegion = (region, url) => {
  const fam = photoFamily(url);
  if (!fam) return false;
  for (const [k, v] of Object.entries(audit)) {
    if (!isHandRejection(v)) continue;
    const [slug, rejected] = k.split('\x01');
    if (regionOf.get(slug) === region && photoFamily(rejected) === fam) return true;
  }
  return false;
};
const ruledOut = (t, url) => {
  if (identityRejection(audit, t.slug, url, t.data.category)) return true;
  if (handRejectedInRegion(String(t.data.region ?? '').trim(), url)) return true;
  const exact = audit[`${t.slug}\x01${cleanCommonsUrl(url)}`] ?? audit[`${t.slug}\x01${url}`];
  return !!exact && /MISMATCH/.test(String(exact.verdict)) && !isMeasurementFailure(exact);
};

// Every place name the site knows (data/countries.json), for "does this file
// name somewhere else?".
const WORLD = await loadWorld().catch(() => null);
const PLACES = [...(WORLD?.regions ?? []), ...(WORLD?.countries ?? [])].map((p) => tokens(p)).filter((t) => t.length);
const PLACE_WORDS = new Set(PLACES.flat());
const fileWordsOf = (url) => tokens(fileOf(url).replace(/^\d+px-/, '').replace(/\.[a-z0-9]+$/i, ''));
// A place counts only when ALL its words are there: "south" alone is a
// direction, not South Korea (Kai_Tak_Arena_South_Entrance; Codex, 11-12).
const otherPlaceIn = (url, own) => {
  const mine = new Set(own.flatMap((s) => tokens(s)));
  const have = new Set(fileWordsOf(url));
  // Own only when ALL its words are ours: Quebec City shares "city" with
  // Mexico City and is still somewhere else (Codex, 11-12).
  return PLACES.find((p) => p.every((w) => have.has(w)) && !p.every((w) => mine.has(w)))?.join(' ') ?? null;
};
// The same kind-of-place words heroTierReason ignores (lib/event-hero-tier
// GENERIC), so the two agree on what a venue's own name is.
const KIND_WORDS = new Set(['the', 'and', 'arena', 'stadium', 'park', 'hall', 'center', 'centre', 'theatre', 'theater', 'club', 'square', 'ground', 'grounds', 'complex', 'venue', 'dome', 'forum', 'city', 'tennis', 'convention', 'exhibition', 'international', 'trade', 'national']);
const distinctWords = (s) => tokens(s).filter((w) => !KIND_WORDS.has(w));
// Whole month names only: "Mayday" is a band, not May (Codex, 11-12).
const MONTH_WORDS = new Set(['jan', 'january', 'feb', 'february', 'mar', 'march', 'apr', 'april', 'may', 'jun', 'june', 'jul', 'july', 'aug', 'august', 'sep', 'sept', 'september', 'oct', 'october', 'nov', 'november', 'dec', 'december']);
// A date, a year or a camera's frame number ("p1140375", "dsc0012"). A name
// with a digit in it ("8turn") is a name.
const NUMBERISH = /^(\d+|[a-z]{1,4}\d{3,})$/;
// What a filename says beyond the place, its kind, the scene and the date.
const residualWords = (url, own) => {
  const mine = new Set(own.flatMap((s) => tokens(s)));
  return fileWordsOf(url).filter((w) => !mine.has(w) && !KIND_WORDS.has(w) && !SCENE_WORDS.has(w)
    && !GENERIC_FILE_WORDS.has(w) && !PLACE_WORDS.has(w) && !NUMBERISH.test(w) && !MONTH_WORDS.has(w));
};

const q = (s) => "'" + String(s).split("'").join("''") + "'";
const fileOf = (url) => { try { return decodeURIComponent(String(url).split('/').pop()); } catch { return String(url).split('/').pop(); } };

const files = (await readdir(DIR)).filter((f) => f.endsWith('.md'));
if (!files.length) { console.log('src/content/posts 가 비어 있다 — 아무것도 하지 않는다'); process.exit(1); }

// Every hero already on the site, so nothing here becomes a duplicate.
const used = new Set();
const targets = [];
for (const f of files) {
  const raw = await readFile(join(DIR, f), 'utf8');
  let data;
  try { ({ data } = matter(raw)); } catch { continue; }
  if (data.region && /^event/.test(String(data.category ?? ''))) regionOf.set(f.replace(/\.md$/, ''), String(data.region).trim());
  // The city's own sights, as this site already covers them: the names to ask
  // Commons for when a skyline search has run dry (Tashkent's Commons is mostly
  // parked cars, and seventeen Tashkent events each need a photo of their own).
  if (data.region && data.draft !== true && /^(attraction|hidden-gem)$/.test(String(data.category ?? ''))) {
    const name = String(data.place?.name || String(data.title ?? '').split(':')[0]).trim();
    const key = String(data.region).trim();
    const list = landmarks.get(key) ?? landmarks.set(key, []).get(key);
    if (name) list.push({ name, n: Number(data.place?.userRatingsTotal) || 0 });
  }
  const url = data.heroImage?.url;
  if (url) { markUsedImage(used, url); continue; }
  if (data.draft === true) continue;
  if (!/^event/.test(String(data.category ?? ''))) continue;
  targets.push({ f, slug: f.replace(/\.md$/, ''), data, raw });
}

console.log(`사진 없는 발행 이벤트 ${targets.length}편 (전체 ${files.length}편 중)`);
if (!targets.length) { console.log('✓ 채울 것이 없다.'); process.exit(0); }

let filled = 0;
const unfilled = [];
for (const t of targets) {
  const region = String(t.data.region ?? '').trim();
  const country = String(t.data.country ?? '').trim();
  if (!region) { unfilled.push(`${t.slug} (region 없음)`); continue; }
  const regionTokens = tokens(region);

  // 1. the region's verified cover, when it is not already someone's hero
  let pick = null;
  const cover = covers[region]?.url;
  // A cover that has been ruled out for this post falls through to Commons; it
  // used to be picked here and then refused below, ending the post's search
  // (Kunming, every night).
  if (cover && !isUsedImage(used, cover) && !ruledOut(t, cover)) {
    pick = { url: cover, credit: covers[region].credit, source: covers[region].source };
  }

  // 2. otherwise Commons: the venue first (the place the reader is going ranks
  //    above the city, as audit-event-heroes already rules), then views of the
  //    city. Each search is walked down past files that are taken, ruled out
  //    or rejected before; until 2026-11-12 only its first file was ever
  //    looked at, so Dubai's "car on a dune bashing tour" was rejected once,
  //    remembered, and then the only answer every night, and 80 upcoming
  //    events in big cities stood without a photo.
  if (!pick) {
    const venue = String(t.data.eventVenue ?? '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    const venueUsable = venue && !/\b(multiple|various|several|venues|tba|tbc|online|citywide|city-wide)\b/i.test(venue);
    // City views: skylines, then the city's best-known sights (most-reviewed
    // first), then kinds of scene. The filename must still name the city
    // (cross + heroTierReason), so a sight's photo is only taken when it says
    // where it is. Each post of the same city starts one step further down
    // this list, so seventeen Tashkent events do not all get the same park.
    const views = [
      `${region} skyline`, `${region} cityscape`,
      ...[...(landmarks.get(region) ?? [])].sort((a, b) => b.n - a.n).slice(0, LANDMARKS_PER_POST).map((l) => `${l.name} ${region}`),
      ...SCENES.map((s) => `${region} ${s}`),
    ];
    // A view that already gave this city a photo tonight goes to the back, or
    // the dozen photos of one park fill a dozen guides.
    const spent = spentViews.get(region) ?? new Set();
    // Only the unspent views rotate; spent ones always come last, or the turn
    // wraps them back in front of views nobody has tried (review, 11-12).
    const fresh = views.filter((v) => !spent.has(v));
    const turn = fresh.length ? (picksIn.get(region) ?? 0) % fresh.length : 0;
    const ordered = [...fresh.slice(turn), ...fresh.slice(0, turn), ...views.filter((v) => spent.has(v))];
    const searches = [
      ...(venueUsable ? [`${venue} ${region}`, venue].map((q) => ({ q, cross: tokens(venue) })) : []),
      ...ordered.map((q) => ({ q, cross: regionTokens, view: true })),
      ...[`${region} ${country}`, region].map((q) => ({ q, cross: regionTokens })),
    ];
    const looked = new Set(used);
    let visionLeft = VISION_PER_POST;
    for (const s of searches) {
      if (pick || visionLeft <= 0) break;
      const ranked = await commonsRanked(s.q, { used: looked, minWidth: MIN_WIDTH, allowPortrait: false, crossCheck: s.cross, minCross: 1 });
      for (const hit of ranked) {
        if (!hit?.url || isUsedImage(looked, hit.url)) continue;
        markUsedImage(looked, hit.url);
        const name = fileOf(hit.url).toLowerCase();
        // The same whole-word test the audit uses to keep a city or venue photo,
        // so nothing placed here is stripped the next morning.
        const tier = heroTierReason(hit.url, t.data, covers);
        if (!tier) continue;
        if (HISTORICAL.test(fileOf(hit.url).replace(/[_]+/g, ' '))) continue;
        // A file that names another place on the site is that place: "Nice view
        // of Chicago skyline" names Nice only as an adjective (11-12 dry run).
        if (otherPlaceIn(hit.url, [region, country, venue])) continue;
        const words = fileWordsOf(hit.url);
        // "City" is not what names Mexico City: Quebec City has it too.
        const cityWords = distinctWords(region).length ? distinctWords(region) : regionTokens;
        const namesCity = cityWords.every((w) => words.includes(w));
        // A venue photo when the venue's own words are in the file, or, for a
        // venue named after its city ("Kaohsiung Arena"), its whole name is.
        // Otherwise every city photo would look like a venue photo and the
        // venue rules would throw out the Confucius Temple (Codex, 11-12).
        const venueOwn = distinctWords(venue).filter((w) => !regionTokens.includes(w) && !tokens(country).includes(w));
        const venueAll = tokens(venue).filter((w) => w !== 'the' && w !== 'and');
        const venuePhoto = !!venue && ((/행사장/.test(tier) && venueOwn.length > 0)
          || (venueAll.length > 1 && venueAll.every((w) => words.includes(w))));
        if (venuePhoto) {
          // A one-word venue is often a chain or a common noun: Cinépolis is a
          // cinema in every Mexican city, and the dry run offered the Mazatlán
          // one for Mexico City. Such a venue photo must name the city too.
          if (venueOwn.length < 2 && !namesCity) continue;
          // A venue photo that says anything beyond the venue, the scene and
          // the date shows someone else's night there: "The Black Keys,
          // Islington Assembly Hall", "Bodega at Islington Assembly Hall" (a
          // band) for an 8TURN show. Another act's photo is the one thing this
          // tier must not place (09-08 rule). City views keep their landmarks.
          if (residualWords(hit.url, [region, country, venue]).length) continue;
        }
        // An event named in the file, outside the venue's own name: "Expo" in
        // AsiaWorld-Expo is the building (Codex, 11-12). Only on a venue photo;
        // a city file saying "Hong Kong Expo 2026" names an event.
        const venueWords = venuePhoto ? new Set(tokens(venue)) : new Set();
        if (NAMES_AN_EVENT.test(words.filter((w) => !venueWords.has(w)).join(' '))) continue;
        // The question vision is asked, and the key its answer is kept under:
        // "not a view of the hall" must not stop the photo as a view of the city.
        const ask = venuePhoto ? `a view of ${venue} in ${region}` : `a view of ${region}`;
        const rejectAs = venuePhoto ? `${region} @ ${venue}` : region;
        // Both answers cost nothing here and a vision call below.
        if (ruledOut(t, hit.url) || wasRejected(rejects, rejectAs, hit.url)) continue;
        // The filename names the place, which a dog breed ("Speckled tongue of
        // the Phu Quoc Ridgeback") or a palace fresco does too. Vision answers
        // the one question the name cannot: is this a view of the place? It
        // fails closed (no key, an outage: no pick), and a person still reads
        // the result in audit-event-hero-identity the next morning.
        if (visionLeft-- <= 0) break;
        const vis = DRY ? { ok: true } : await verifyHeroImage({ url: hit.url, name: ask, category: 'present-day city, venue, landscape or landmark view that would make an attractive banner (not an archival or historical photo, not a vehicle, animal, product or close-up)', region, country });
        if (!vis.ok) {
          console.log(`  · ${t.slug.slice(0, 46)}: ${fileOf(hit.url).slice(0, 40)} — vision: ${String(vis.reason).slice(0, 70)}`);
          if (!DRY && rememberRejection(rejects, rejectAs, hit.url, vis.reason)) rejectsChanged = true;
          continue;
        }
        pick = { url: hit.url, credit: hit.credit, source: hit.source };
        if (s.view) (spentViews.get(region) ?? spentViews.set(region, new Set()).get(region)).add(s.q);
        break;
      }
    }
  }

  if (!pick?.url) { unfilled.push(`${t.slug} (${region} 사진 없음)`); continue; }
  // The exact rejection requarantine-mismatches enforces — it ran BEFORE this
  // step, so a pick it would strip was committed and pushed, then stripped by
  // the post-push re-assert: the Phu Quoc Latin festival got the same 500px dog
  // photo and lost it again on ten nights running (2026-09-25..10-04).
  if (ruledOut(t, pick.url)) {
    unfilled.push(`${t.slug} (이 사진은 이미 불합격 기록이 있음)`);
    continue;
  }

  const url = cleanCommonsUrl(pick.url);
  console.log(`  ${DRY ? '·' : '+'} ${t.slug.slice(0, 46).padEnd(48)}${fileOf(url).slice(0, 44)}`);
  markUsedImage(used, url);
  picksIn.set(region, (picksIn.get(region) ?? 0) + 1);
  filled++;
  if (DRY) continue;

  const eol = t.raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = t.raw.split(eol);
  const fmEnd = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  let at = lines.findIndex((l, i) => i < fmEnd && l.startsWith('gallery:'));
  if (at < 0) at = lines.findIndex((l, i) => i < fmEnd && l.startsWith('tags:'));
  if (at < 0) { unfilled.push(`${t.slug} (프론트매터에 넣을 자리 없음)`); filled--; continue; }
  lines.splice(at, 0,
    'heroImage:',
    '  url: ' + q(url),
    '  credit: ' + q(pick.credit || 'Photo: Wikimedia Commons'),
    '  license: wikimedia',
    '  source: ' + q(pick.source || ''));
  await writeFile(join(DIR, t.f), lines.join(eol), 'utf8');
}

if (rejectsChanged && !DRY) await writeFile(REJECTS_FILE, JSON.stringify(rejects, null, 1) + '\n', 'utf8');

for (const u of unfilled) console.log(`  ⚠️  ${u}`);
console.log(`\nCITY_HERO_SUMMARY filled=${filled} unfilled=${unfilled.length} targets=${targets.length}`);
