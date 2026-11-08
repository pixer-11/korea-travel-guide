// Identity cross-audit ON THE FILENAME for event heroes — shared by the night
// patrol (backfill-photos-alt) and the width upgrader, which used to carry two
// diverging copies of the same rule (2026-08-22: one had the venue fix, the
// other did not).
//
// Why the filename: vision cannot tell acts apart (the known blind spot). The
// first live run handed the Singapore Post Malone post "F1_Rocks_Singapore.jpg"
// — a real photo of a DIFFERENT 2009 concert — and vision approved it as
// "generic concert". A file that names the act is identity-confirmed; a file
// that does not must be explainable by the event's own words.
//
// What counts as "the event's own words" depends on HOW the file was found —
// that is what `via` carries (stamped by resolveHero):
//   'venue'  — found by the venue's name with the venue tokens cross-checked.
//              The rest of the name is a scene description: "Remote view of
//              Stade de France", "Inspire Entertainment Resort Exterior",
//              "Circuit of the Americas aerial view". Those words are not an
//              act. Before this distinction every venue find was refused —
//              "remote view", "exterior", "aerial view", "metro", "day" all
//              read as "another act" (17 events photoless, 2026-08-22).
//              A leftover that is NOT a scene word ("Mayday Taipei Dome
//              Concert", "Cirque du Soleil at Circuit of the Americas",
//              "Central Tour Indochine … Stade de France") is another act
//              at the venue — refused, exactly as before.
//   'phrase' — found by the event's proper name with every name token
//              cross-checked ("Festival Huế"). Same scene tolerance; a
//              leftover name ("Penutupan Para Asian Games" — the Para Games,
//              a sibling event) still refuses.
//   anything else (act anchor / type / topic searches) — the strict rule:
//              one leftover proper noun means some other act's photo.
//
// Across venue and phrase finds there is one more way out, added 2026-08-30:
// a file that spells the event's WHOLE proper name out, in order, is naming
// the event, and whatever else it says is describing the shot ("Face Piercing
// Phuket Vegetarian Festival 12"). That is deliberately not the same as
// "contains the anchor word" — see namesTheEvent for the two conditions and
// the sibling event they exist to keep out.
import { tokens, allWords, ANCHOR_STOP, COMMON_ANCHOR, isCommonAnchor } from './commons.mjs';
import { GEO_STOP } from './images.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventProperName, eventSchemaName } from '../../src/lib/eventName.mjs';

// A city our guides call one thing and its own photographers another. Only
// cities the site actually covers, and only names that are not a spelling
// variant fold() already handles. "Köln Marathon 2015" is the Cologne Marathon,
// and the daily audit took all four of its Köln photos off that guide as
// "shares only marathon with the title" (2026-11-05…08).
const PLACE_ALIASES = {
  cologne: ['koln', 'koeln', 'kolner'],
  munich: ['munchen', 'muenchen', 'munchner'],
  nuremberg: ['nurnberg', 'nuernberg', 'nurnberger'],
  dusseldorf: ['duesseldorf'],
  rome: ['roma'],
  florence: ['firenze'],
  venice: ['venezia'],
  milan: ['milano'],
  naples: ['napoli'],
  turin: ['torino'],
  genoa: ['genova'],
  seville: ['sevilla'],
};
const PLACE_CANON = new Map(Object.entries(PLACE_ALIASES).flatMap(([en, others]) => others.map((o) => [o, en])));
export const samePlace = (w) => PLACE_CANON.get(w) ?? w;

// The `geo` set for foreignInFilename: hub cities plus every country and
// region the site covers (loadWorld() from commons-identity), as tokens.
export function geoTokens(world = null) {
  return new Set([
    ...GEO_STOP,
    ...(world?.regions || []).flatMap((r) => tokens(r)),
    ...(world?.countries || []).flatMap((c) => tokens(c)),
  ]);
}

export const GENERIC_FILE_WORDS = new Set([
  'cropped', 'crop', 'photo', 'image', 'img', 'file', 'dsc', 'edit', 'edited',
  'retouched', 'wikimedia', 'commons', 'flickr', 'panoramio', 'geograph',
  'jpg', 'jpeg', 'png',
]);

// Words that describe a PHOTO of a place rather than name what is in it.
export const SCENE_WORDS = new Set([
  'exterior', 'interior', 'inside', 'outside', 'view', 'views', 'aerial', 'remote',
  'panorama', 'panoramic', 'overview', 'skyline', 'night', 'evening', 'morning',
  'day', 'dusk', 'dawn', 'sunset', 'sunrise', 'gate', 'gates', 'entrance', 'entry',
  'facade', 'front', 'side', 'rear', 'back', 'north', 'south', 'east', 'west',
  'main', 'marker', 'metro', 'building', 'hall', 'dome', 'track', 'circuit',
  'grandstand', 'grandstands', 'paddock', 'padock', 'pitch', 'field', 'seats',
  'stands', 'stage', 'crowd', 'audience', 'drone', 'satellite', 'skysat', 'wide',
  'closeup', 'close', 'detail', 'roof', 'tower', 'area', 'square', 'lights',
  'illuminated', 'illumination', 'from', 'with', 'during', 'near', 'over',
  'above', 'its', 'new', 'old', 'empty', 'full', 'before', 'after', 'under',
  // What happens at the event, for a phrase find ("Asian Games opening").
  'opening', 'closing', 'ceremony', 'ceremonies', 'podium', 'parade', 'race',
  'match', 'fireworks', 'session', 'practice', 'qualifying', 'crowds', 'fans',
]);

// A COMMON word used as the anchor (forever, football, super, moon…) is not
// identity on its own; a real proper noun (bts, babymonster, plk) is.
// Defined in commons.mjs so the resolver can rank its searches by it too.
export { COMMON_ANCHOR };

// Every word in the filename, the short ones included. fileTokens drops
// words of 1-2 characters, and those are exactly the words that carry the
// identity inside a hyphenated anchor.
function fileWords(url) {
  let file = String(url).split('/').pop() || '';
  try { file = decodeURIComponent(file); } catch {}
  return allWords(file.replace(/\.(jpe?g|png|webp)\b.*$/i, ''));
}

export function fileTokens(url) {
  return fileWords(url).filter((w) => w.length > 2);
}

// A file that names an EVENT is that event's photo, not the place's ("Santander
// La Mezza di Torino 2017" on the Torino City Marathon, 2026-10-06). Shared by
// the city tier (fill-event-city-heroes) and the identity audit.
export const NAMES_AN_EVENT = /\b(marathon|maratona|maraton|mezza|half|race|run|festival|fest|concert|tour|cup|championship|games|parade|carnival|match|derby|gala|expo|fair)\b/i;
const VENUE_GENERIC = new Set(['stadium', 'arena', 'hall', 'centre', 'center', 'theatre', 'theater', 'park', 'expo', 'convention', 'exhibition', 'dome', 'square', 'national', 'international', 'the']);

/**
 * Is this hero a view of the event's PLACE rather than of some other event?
 * The owner's third tier (2026-09-11) is "the best photo of the city", and the
 * venue is the event's own place too — Uber Arena for a Berlin show, AsiaWorld-
 * Expo for a Hong Kong tour. Such a file was reported every day as "maybe
 * another event's photo" (34 lines on 2026-10-09, ~29 of them city or venue
 * views). True when the file names the venue (a distinctive word of it), or
 * names the whole city and no event at all.
 */
export function fileShowsPlace(url, { region = '', venue = '' } = {}) {
  const words = new Set(fileTokens(url).map(samePlace));
  const venueWords = tokens(venue).filter((w) => !VENUE_GENERIC.has(w));
  if (venueWords.length && venueWords.some((w) => words.has(w))) return true;
  const cityWords = tokens(region).map(samePlace);
  if (!cityWords.length || !cityWords.every((w) => words.has(w))) return false;
  return !NAMES_AN_EVENT.test(fileWords(url).join(' '));
}

// Does the FILE name the act? Normally the anchor is one token and this is a
// containment test. But keyToken deliberately keeps a hyphenated lead word
// WHOLE — the anchor for "U-Know … Yunho" must not fall to the meaningless
// "know" — while tokens() turns every hyphen into a space, so no file token
// can ever contain one. The two rules met at `ft.includes(anchor)`, which was
// therefore false for EVERY hyphenated anchor: a genuine photo of the act was
// refused as "names another act", silently and permanently (2026-08-30).
//
// So a hyphenated anchor matches as its parts in a contiguous run, checked
// word by word against the WHOLE filename rather than against fileTokens.
// Dropping the short part is the dangerous half: "u-know" reduced to "know"
// clears the scanned book pages Commons actually returns for that act
// ("Do you know? - DPLA - …"). The short word has to really be there.
export function fileNamesAnchor(url, anchor) {
  if (!anchor) return false;
  if (!anchor.includes('-')) return fileTokens(url).includes(anchor);
  const parts = anchor.split('-').filter(Boolean);
  const words = fileWords(url);
  for (let i = 0; i + parts.length <= words.length; i++) {
    if (parts.every((t, j) => words[i + j] === t)) return true;
  }
  return false;
}

// The event's whole name as an ordered run of identity words. Digits are not
// identity anywhere in this file (a year is an edition, not an act), so they
// drop out of both sides of the comparison.
const nameRun = (name) => tokens(name).filter((t) => !/\d/.test(t));

// Does the FILE name the event outright — its whole proper name, in order?
//
// That is a stronger claim than "contains the anchor token", and the
// difference is the whole safety margin. Moving the anchor rule up here
// would have cleared "Penutupan Para Asian Games 2018" for the Asian Games
// post, because a sibling event's name contains ours whole. So two things
// are required, and the second is what keeps the sibling out:
//   1. every name word, CONTIGUOUS and in order — "Vegetarian Festival
//      Kuala Lumpur" is the same festival in another city, and is refused
//      because "phuket" is missing from the run;
//   2. at least one word that is identity on its own. "Asian Games" is two
//      stop-words and a year — nothing in it distinguishes the Para Games —
//      so containment proves nothing there and the rule stays off.
// A one-word name is off by rule 1: it would be the bare anchor test again.
function namesTheEvent(ft, name, geo) {
  const run = nameRun(name);
  if (run.length < 2) return false;
  const identity = (t) =>
    !ANCHOR_STOP.has(t) && !COMMON_ANCHOR.test(t) &&
    !SCENE_WORDS.has(t) && !GENERIC_FILE_WORDS.has(t) && !(geo && geo.has(t));
  // Rule 2 is for SHORT names. "Asian Games" is two stop-words, so containment
  // proves nothing and the Para Games slip through — that is why it exists. But
  // a FOUR-word contiguous run is specific on its own even when every word is a
  // stop-word or a place: "Busan International Film Festival" spelled out in
  // order is that festival, and the rule refused its own photos ("IU for Broker
  // open talk at Busan International Film Festival") as "another act", leaving
  // the post dark while its festival sat in the filename (2026-09-10).
  if (run.length < 4 && !run.some(identity)) return false;
  const words = ft.filter((t) => !/\d/.test(t));
  for (let i = 0; i + run.length <= words.length; i++) {
    if (run.every((t, j) => words[i + j] === t)) return true;
  }
  return false;
}

// Place words of the post's OWN country (its name and its regions). A place
// in the same country is not "another event's city" — George Town's festival
// shot is labelled "Georgetown, Penang". Read lazily from data/countries.json;
// when it cannot be read the set is empty and every place counts (the rule
// errs toward refusing, never toward passing blind).
const ROOT_DIR = fileURLToPath(new URL('../../', import.meta.url));
let COUNTRY_GEO = null;
export function homeGeoTokens(country) {
  if (!country) return new Set();
  if (!COUNTRY_GEO) {
    COUNTRY_GEO = new Map();
    try {
      const w = JSON.parse(readFileSync(join(ROOT_DIR, 'data/countries.json'), 'utf8'));
      for (const c of w.countries || []) COUNTRY_GEO.set(c.name, new Set([...tokens(c.name), ...(c.regions || []).flatMap((r) => tokens(r))]));
    } catch {}
  }
  return COUNTRY_GEO.get(country) ?? new Set();
}
// The words of every country NAME — a country is not "another city".
let COUNTRY_NAMES = null;
function countryNameTokens() {
  if (!COUNTRY_NAMES) {
    COUNTRY_NAMES = new Set();
    try {
      const w = JSON.parse(readFileSync(join(ROOT_DIR, 'data/countries.json'), 'utf8'));
      const regionWords = new Set((w.countries || []).flatMap((c) => (c.regions || []).flatMap((r) => tokens(r))));
      // A city-state is both: "Singapore Standard Chartered Marathon" names a city.
      for (const c of w.countries || []) for (const t of tokens(c.name)) if (!regionWords.has(t)) COUNTRY_NAMES.add(t);
    } catch {}
  }
  return COUNTRY_NAMES;
}
// Place-name tokens too ambiguous to mean "another city": "South entrance of
// the National Tennis Center" is Beijing, not South Korea.
const AMBIG_PLACE = new Set(['south', 'north', 'east', 'west', 'new', 'city', 'town', 'san', 'santa', 'saint', 'port', 'bay',
  'island', 'islands', 'old', 'great', 'little', 'upper', 'lower', 'central', 'kota', 'beach', 'lake', 'mount', 'hill',
  'international', 'national', 'royal', 'metropolitan', 'grand', 'world', 'asia', 'asian', 'europe', 'european']);

// Words that make a file a different KIND of event when the post's own title
// lacks them: an ultramarathon is not a dance festival, a wheelchair final is
// not the men's final.
const OTHER_KIND = new Set(['marathon', 'ultramarathon', 'triathlon', 'duathlon', 'wheelchair', 'paralympic', 'paralympics',
  'junior', 'juniors', 'youth', 'masters', 'veterans', 'women', 'womens', 'relay', 'walkathon']);

// Does the FILE name the performer (frontmatter eventPerformer.name)? The
// owner's rule since 09-07: a singer's or band's post may carry ANY photo of
// that act — another city's show, another year, off stage. Before this the
// act test saw only the one-word anchor of the TITLE ("guns" for Guns N'
// Roses), so "Guns N' Roses at PreZero Gliwice" was refused as "names another
// act (prezero gliwice)", and the post went out with a typeset cover while
// Commons held dozens of the band (2026-10-06, owner: "몇번이나 말했잖아").
//   · two or more name words, contiguous and in order ("guns n roses",
//     "jason mraz", "avenged sevenfold") — specific on its own;
//   · one word only when it is a name, not an ordinary word, and 4+ letters
//     ("babymonster", "joji"); a common first name alone ("Khalid") still
//     needs the anchor rule's corroboration in foreignInFilename.
export function fileNamesPerformer(url, performer, { singleWord = true } = {}) {
  const run = allWords(String(performer ?? '')).filter((t) => !/\d/.test(t));
  if (!run.length) return false;
  const words = fileWords(url).filter((t) => !/\d/.test(t));
  if (run.length === 1) {
    const w = run[0];
    // Short acts styled in capitals (BTS, EXO, XG) are names, not words.
    const styledName = /^[A-Z0-9]{2,5}$/.test(String(performer).trim());
    return singleWord && (styledName || (w.length >= 4 && !isCommonAnchor(w))) && words.includes(w);
  }
  const contiguous = (r, ws) => {
    for (let i = 0; i + r.length <= ws.length; i++) if (r.every((t, j) => ws[i + j] === t)) return true;
    return false;
  };
  if (contiguous(run, words)) return true;
  // "Guns N' Roses" is also written "Guns and Roses" / "Guns Roses": compare
  // without the 1-2 letter joiners, still requiring 2+ real words.
  const long = run.filter((t) => t.length > 2);
  return long.length >= 2 && contiguous(long, words.filter((t) => t.length > 2 && t !== 'and'));
}

// Is this hero the performer's own picture, by either proof we accept: the file
// names the act, or the patrol took it from the act's Commons category and wrote
// that down (Westlife2, Big_Bang and 소지섭 files never spell the act as we do).
// No performer, no answer: the proof file also records event-category finds, and
// a 2009 Toray Pan Pacific Open photo is not Naomi Osaka's because her guide wears
// it. So the category has to be the act's own, compared without spaces or Commons'
// bracket: BIGBANG is filed as "Big Bang (musical group from South Korea)".
// allWords keeps Latin letters only, so a name written in another script falls
// back to itself: 소지섭's category is compared, not an empty string (Codex, 11-09).
const actKey = (name) => {
  const bare = String(name ?? '').replace(/\s*\(.*\)\s*$/, '');
  return allWords(bare).join('') || bare.replace(/\s+/g, '').toLowerCase();
};
export function isPerformerPhoto(url, performer, proof) {
  if (!performer) return false;
  const act = actKey(performer);
  return (Boolean(act) && proof?.url === url && actKey(proof?.category) === act) || fileNamesPerformer(url, performer);
}

// Returns '' when the file is identity-safe, otherwise the leftover words that
// make it some other thing's photo (for the log).
// `geo`: place-name tokens (the site's countries and regions plus the hub
// cities). For a phrase/venue find a leftover place name is WHERE a past
// edition was held, not WHO — "Hangzhou 2022 Asian Games" is the Asian
// Games (refused six times as "another act", 2026-08-22). For an act find
// it stays a leftover: "street football in Bangkok" is still not the act.
// `name`: the event's proper name (eventProperName). A file that spells that
// name out in full is identity-confirmed even when it also describes what is
// happening in the shot — ~35 large CC-BY files called "Face Piercing Phuket
// Vegetarian Festival NN.jpg" were refused as "names another act (face
// piercing)" until this existed (2026-08-30). See namesTheEvent for why the
// bare anchor token is not enough.
export function foreignInFilename(url, { known, anchor = '', via = '', geo = null, name = '', acronym = '', performer = '', country = '', region = '' }) {
  // A file that names the act in full is the act, wherever and whenever it
  // was shot (fileNamesPerformer). Multi-word names only here: a lone first
  // name ("Khalid") is too common to clear "State Minister Khalid, Dhaka".
  if (performer && fileNamesPerformer(url, performer, { singleWord: false })) return '';
  const ft = fileTokens(url);
  const leftovers = ft.filter((t) =>
    !known.has(t) && !known.has(samePlace(t)) && !GENERIC_FILE_WORDS.has(t) &&
    // Camera/file ids ("wn4430", "d161208", "dsc0123", "3840px") and the
    // event words that are never an act's identity (concert, festival,
    // stadium, tour, months, nation adjectives).
    !/\d/.test(t) && !ANCHOR_STOP.has(t));
  // A find by the acronym OUR OWN TITLE declares. The acronym is the identity:
  // "MEFCC AUH 2023 - Crowd Shot" is this convention two editions back, and the
  // rest of the name describes the shot. Before this the post was handed 24
  // candidates anchored on the word "middle" — satellite views of the Middle
  // East, an air-force flight, a man-in-the-middle attack diagram — and stayed
  // photoless while its own 2023 crowd shot sat one query away (2026-09-10).
  // A file that came back from that search WITHOUT the acronym in its name
  // proves nothing and falls through to the rules below.
  // Two ways out, and no third: the acronym itself, or the whole name spelled
  // out in order. Deliberately NOT the scene-tolerant branch below — that one
  // forgives a leftover PLACE name (a past edition held elsewhere), which for a
  // film festival would hand the Busan post a Tokyo International Film Festival
  // photo. Same words, different festival.
  // A PLACE-BOUND event — a marathon, a cup, a festival, not a touring act — is
  // held where it is held: its past edition is right (the owner's second tier),
  // the same KIND of event elsewhere is a different event. Vision only asks
  // "is this a marathon?", and on 2026-10-06 it approved the 2016 London
  // Marathon for Florence, the Singapore marathon for Kuala Lumpur, England's
  // wheelchair team for Brisbane's final, Indonesian drums for Kuching and an
  // ultramarathon runner for the ULTRA Taiwan dance festival. Three rules,
  // judged from the event's own NAME (Codex, 10-06):
  //   1. a name that carries its place (Busan International Film Festival,
  //      Florence Marathon, Hangzhou Marathon) needs that place in the file —
  //      or the acronym. Tokyo's film festival and Beijing's marathon are out,
  //      though both cities are "known places";
  //   2. a name without a place that travels (World Cup, Asian Games) may show
  //      a past edition anywhere — "Rugby League World Cup 2013 London";
  //   3. otherwise another country's place name refuses the file.
  // And a kind of event the title lacks (marathon, wheelchair, youth…) refuses
  // it everywhere. Venue finds are exempt: they are identified by the venue.
  // A touring act keeps the old rule — its other cities are its other nights —
  // and an act's name alone ("Evanescence Madrid 2026") counts as one: 24
  // concert posts carry no eventPerformer field.
  const actLike = performer || /\b(concerts?|tours?|live|fan ?meet(ing)?|showcase|recital)\b/i.test(name);
  if (!actLike && via !== 'venue') {
    const home = homeGeoTokens(country);
    const regionToks = new Set(tokens(region));
    const isCity = (t) => !AMBIG_PLACE.has(t) && !countryNameTokens().has(t) && ((geo && geo.has(t)) || regionToks.has(t) || home.has(t));
    // The FIXED place is the one the name LEADS with ("Busan International
    // Film Festival", "Florence Marathon"); a trailing one is this year's host
    // ("PGL Major Singapore", "ChinaJoy 2026 (Shanghai)"), and a past edition
    // elsewhere is right for those.
    const lead = allWords(name).filter((w) => !/\d/.test(w) && w !== 'the').slice(0, 2);
    const locality = lead.filter(isCity);
    const byAcronym = acronym && ft.includes(String(acronym).toLowerCase());
    // Refuse only when the file names ANOTHER city instead: "2015 Pentaport
    // Rock Festival" for the Incheon one carries no city and is its past edition.
    const otherCity = ft.filter((t) => isCity(t) && !locality.includes(t) && !regionToks.has(t));
    if (locality.length && !byAcronym && !locality.some((t) => ft.includes(t)) && otherCity.length) return `not ${locality.join(' ')}: ${otherCity.join(' ')}`;
    const placeBound = /\b(marathon|race|run|cup|final|games|championships?|open|festival|fest|fair|carnival|parade|expo|matsuri|derby|regatta|league)\b/i.test(name);
    const travelling = /\b(world|asian|games|olympics?|paralympics?|commonwealth|championships?|cup|euro\w*|major)\b/i.test(name);
    const otherPlace = placeBound && !locality.length && !travelling
      ? leftovers.filter((t) => geo && geo.has(t) && !home.has(t) && !AMBIG_PLACE.has(t)) : [];
    const otherKind = ft.filter((t) => OTHER_KIND.has(t) && !known.has(t));
    if (otherPlace.length || otherKind.length) return [...otherPlace, ...otherKind].join(' ');
  }
  if (via === 'acronym') {
    if (acronym && ft.includes(String(acronym).toLowerCase())) return '';
    if (namesTheEvent(ft, name, geo)) return '';
  }
  if (via === 'venue' || via === 'phrase') {
    const rest = leftovers.filter((t) => !SCENE_WORDS.has(t) && !(geo && geo.has(t)));
    if (!rest.length) return '';
    return namesTheEvent(ft, name, geo) ? '' : rest.join(' ');
  }
  // An ACT find — the anchor search. The anchor is ONE word, and one word was
  // never identity: "Quick Style India Tour" anchors on "quick" and Commons
  // answered with the Shoeburyness Quick Fire Battery; "One Universe Festival"
  // anchors on "one" and answered with a COSCO container ship. Both passed
  // because their anchor was missing from COMMON_ANCHOR's hand-written list,
  // and that list can never be finished — every new event brings a new ordinary
  // word. isCommonAnchor now measures the question instead of listing it
  // (scripts/build-common-words.mjs), but measuring is only half of it.
  //
  // The whole name still beats the anchor: a file that spells the event out in
  // order is naming it, wherever the shot was taken. "Camille Munro at Miss
  // World 2013 Talent Competition" is Miss World, and no anchor rule can see
  // that, because "miss" is an ordinary word.
  if (namesTheEvent(ft, name, geo)) return '';
  // Otherwise the anchor needs corroboration, and how much depends on whether
  // it is a name at all. A name may carry a couple of extra words, because the
  // shot had to be taken somewhere ("The Weeknd at Bumbershoot", "Evanescence
  // at concert in San Petersburg"). An ordinary word may carry at most one —
  // the sport-plus-player case this rule was written for ("Snooker table
  // selby"). Place names and scene words are not counted against either: a
  // past edition was held somewhere, and every photo was taken from an angle.
  const anchorIsName = anchor && !isCommonAnchor(anchor);
  if (anchor && fileNamesAnchor(url, anchor)) {
    const rest = leftovers.filter((t) => !SCENE_WORDS.has(t) && !(geo && geo.has(t)));
    if (anchorIsName ? rest.length <= 4 : !rest.length) return '';
    // That one extra word comes AFTER an ordinary anchor. In front of it, it
    // says whose the word is: "Atlas Sound", "Primavera Sound" and "The Warning
    // at Sound of Music" all passed for Lima's "Sound Music Fest", one a night
    // for a week, and the publish audit took each off the next afternoon
    // (2026-11-02…07). A second word of the event's own name or city still
    // clears it ("YoonA at Asia Artist Awards"): the anchor is not alone then.
    if (!anchorIsName && rest.length === 1) {
      const fronted = ft.indexOf(rest[0]) < ft.indexOf(anchor);
      const backed = ft.some((t) => t !== anchor && known.has(t) && !/\d/.test(t) && !ANCHOR_STOP.has(t) && !SCENE_WORDS.has(t));
      if (!fronted || backed) return '';
    }
  }
  return leftovers.join(' ');
}

// ── THE SAME QUESTION, ASKED BY THE DAILY AUDIT ──
//
// audit-event-hero-identity calls two shared title words "this file names the
// event" and removes the photo otherwise. The rule used to live in that script
// with a word list of its own, blind to everything the patrol above knows: it
// dropped words of three letters (ATP), split Köln into nothing, and took the
// 111th Grey Cup for another event than the 113th. So the patrol attached a past
// edition, the owner's second tier, and the audit removed it the next day: 17 of
// the 56 repeat removals between 10-28 and 11-07 were right photos.
//
// The two-word rule stays on this side only. Copied to the patrol it would
// refuse the same past editions for good.

// Words that say nothing about WHICH event this is. Leaving them in made
// "World Tour" or "Live Concert" look like evidence of a match.
const TITLE_STOP = new Set(['the', 'of', 'in', 'at', 'and', 'an', 'guide', 'travel', 'jpg', 'jpeg',
  'png', 'file', 'commons', 'wikipedia', 'thumb', 'live', 'concert', 'tour', 'world', 'festival',
  'tickets', 'dates', 'venue', 'city', 'show', 'music', 'performing', 'during', 'stage', 'know',
  'what', 'fest', 'anniversary']);

const ORDINAL = /^\d+(st|nd|rd|th)$/;

// A title that opens with its number and then says just two words names a
// numbered series: "113th Grey Cup". Not "Pentagon 10th Anniversary Tour", where
// the number is the act's own and any band's anniversary tour has the same words.
// Not "5th President Cup (Chess)", where the third word is all that separates it
// from a golf President Cup. Not two words that are the city or say nothing.
function numberedSeries(title, city) {
  const [edition, first, second, ...more] = allWords(eventSchemaName(title).split(':')[0]).map(samePlace);
  if (!ORDINAL.test(edition ?? '') || !second || more.length) return null;
  return [first, second].some((w) => TITLE_STOP.has(w) || city.includes(w)) ? null : [first, second];
}

// The initials of a name our own title spells out: "ASEAN-Korea Music Festival"
// is filed on Commons as AKMF. Four words at least. eventAcronym refuses to
// guess because a search runs on it alone; here it is only ever one piece of
// evidence beside another word of the title.
export function spelledOutInitials(title) {
  const out = new Set();
  for (const part of String(title ?? '').split(':')[0].split(/[()（）–—]/)) {
    const caps = part.split(/[\s-]+/).filter((w) => /^[A-Z]/.test(w));
    if (caps.length >= 4) out.add(caps.map((w) => w[0]).join('').toLowerCase());
  }
  return [...out];
}

/**
 * Which words of the post's title does this filename also say? Two is what the
 * audit accepts as naming the event; the list goes into its report.
 * @param {string} title  the post's title
 * @param {string} url    the hero's URL
 * @param {{region?: string}} [where]  the post's city
 * @returns {string[]}
 */
export function titleWordsInFile(title, url, { region = '' } = {}) {
  // A number is an edition, never identity: "10th" in both names proves nothing.
  const keep = (w) => w.length > 3 && !TITLE_STOP.has(w) && !/^\d+$/.test(w) && !ORDINAL.test(w);
  const fileAll = fileWords(url).map(samePlace);
  const titleAll = allWords(title).map(samePlace);
  const fileToks = fileAll.filter(keep);
  // A long word also matches its own inflection: "Dani Pedrosa MotoGP Australia
  // 2015" is the Australian Grand Prix (flagged 2026-10-12, the one right photo
  // among seven). Six letters at least, so "young" never matches "youngfathers".
  const same = (t) => fileToks.includes(t) || fileToks.some((f) => Math.min(f.length, t.length) >= 6 && (f.startsWith(t) || t.startsWith(f)));
  // A Set: "Hanoi Jazztival 2026 in Hanoi" against Hanoi_traffic.jpg scored two
  // hits for one word and walked past review.
  const hit = new Set(titleAll.filter(keep).filter(same));
  // What the length filter cannot see. Three capitals in OUR title are a name
  // (ATP, NBA, BWF), three lower-case letters are not (cup, day, new). A Roman
  // numeral is not: "Jayavarman VII High School" is not the festival.
  for (const caps of String(title ?? '').match(/(?<![A-Za-z0-9])[A-Z][A-Z0-9]{2}(?![A-Za-z0-9])/g) ?? []) {
    const w = caps.toLowerCase();
    if (/^(iii|vii|xii|xiv|xvi|xix|xxi|xxv|xxx)$/.test(w)) continue;
    if (!TITLE_STOP.has(w) && !isCommonAnchor(w) && fileAll.includes(w)) hit.add(w);
  }
  for (const w of spelledOutInitials(title)) if (fileAll.includes(w)) hit.add(w);
  // "111th Grey Cup" and "Grey Cup, 2022" are both past editions of the 113th, and
  // the series' own name is the evidence: cup is too short and grey too ordinary
  // for the rules above. A word in front says whose it is ("Earl Grey Cup", "Miss
  // Grey Cup"); a number, a year or "at the" does not.
  const city = allWords(region).map(samePlace);
  const series = numberedSeries(title, city);
  if (series) fileAll.forEach((f, j) => {
    const before = fileAll[j - 1];
    if (f === series[0] && fileAll[j + 1] === series[1] && (!before || /\d/.test(before) || TITLE_STOP.has(before))) series.forEach((w) => hit.add(w));
  });
  // A city of short words only ("Da Lat", "Hoi An") never survives the length
  // filter, however plainly the file says it. "Da Nang" is already counted.
  if (city.length && city.every((w) => w.length <= 3 && fileAll.includes(w))) hit.add(city.join(' '));
  return [...hit];
}

/**
 * Does the file spell the event's whole proper name, in order? The patrol's own
 * test (namesTheEvent), so the audit no longer removes what it just accepted
 * (".Feast at Joyland Festival, November 2024" on the Joyland guide). A short
 * name needs a word that is not an ordinary one: "Round Festival" is also the
 * tail of "River Runs Round festival", which is in County Cork.
 */
export function fileSpellsEventName(url, title, geo = null) {
  const name = eventProperName(title);
  const run = nameRun(name);
  if (run.length < 4 && !run.some((t) => !isCommonAnchor(t) && !ANCHOR_STOP.has(t))) return false;
  return namesTheEvent(fileTokens(url), name, geo);
}

/**
 * Everything the daily audit accepts from the filename alone: two title words,
 * the event's whole name, the act, or the event's own city or venue. One
 * function, so the patrol's cooldown cannot drift from what the audit removes.
 * @param {string} url
 * @param {any} fm    the post's frontmatter
 * @param {Set<string>|null} [geo]
 */
export function fileIdentifiesEvent(url, fm, geo = null) {
  return titleWordsInFile(fm?.title, url, { region: fm?.region }).length >= 2
    || fileSpellsEventName(url, fm?.title, geo)
    // The owner's rule (09-07): any photo of the performer is right for their
    // post. The Weeknd at Coachella 2012 for his Hong Kong date was reported
    // as unreviewed (2026-10-06).
    || fileNamesPerformer(url, fm?.eventPerformer?.name)
    // A view of the event's own city or venue is the owner's third tier, not
    // another event's photo (2026-10-09: most of the 34 daily lines were these).
    || fileShowsPlace(url, { region: fm?.region, venue: fm?.eventVenue });
}
