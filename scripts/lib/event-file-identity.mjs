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
import { tokens, ANCHOR_STOP, COMMON_ANCHOR } from './commons.mjs';
import { GEO_STOP } from './images.mjs';

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

export function fileTokens(url) {
  let file = String(url).split('/').pop() || '';
  try { file = decodeURIComponent(file); } catch {}
  return tokens(file.replace(/\.(jpe?g|png|webp)\b.*$/i, ''));
}

// Returns '' when the file is identity-safe, otherwise the leftover words that
// make it some other thing's photo (for the log).
// `geo`: place-name tokens (the site's countries and regions plus the hub
// cities). For a phrase/venue find a leftover place name is WHERE a past
// edition was held, not WHO — "Hangzhou 2022 Asian Games" is the Asian
// Games (refused six times as "another act", 2026-08-22). For an act find
// it stays a leftover: "street football in Bangkok" is still not the act.
export function foreignInFilename(url, { known, anchor = '', via = '', geo = null }) {
  const ft = fileTokens(url);
  const leftovers = ft.filter((t) =>
    !known.has(t) && !GENERIC_FILE_WORDS.has(t) &&
    // Camera/file ids ("wn4430", "d161208", "dsc0123", "3840px") and the
    // event words that are never an act's identity (concert, festival,
    // stadium, tour, months, nation adjectives).
    !/\d/.test(t) && !ANCHOR_STOP.has(t));
  if (via === 'venue' || via === 'phrase') {
    return leftovers.filter((t) => !SCENE_WORDS.has(t) && !(geo && geo.has(t))).join(' ');
  }
  const anchorIsName = anchor && !COMMON_ANCHOR.test(anchor);
  if (anchorIsName && ft.includes(anchor)) return '';
  // A common-word anchor that IS the sport ("snooker", "football") is still
  // identity when the file is about that sport and names one extra thing —
  // a player ("Snooker_table_selby"). Two or more leftovers is a scene
  // described elsewhere ("boys playing street … egypt") and refused.
  if (anchor && ft.includes(anchor) && leftovers.length <= 1) return '';
  return leftovers.join(' ');
}
