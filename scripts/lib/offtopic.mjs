// Shared "off-topic hero image" guard. A keyword-collision Wikimedia file whose
// subject is clearly unrelated to a venue — a moth specimen, a dune-bashing car,
// US-Navy admirals, a museum statue. Extracted from validate-content.mjs so the
// publish gate AND the newsletter renderer reject the exact same bad heroes.
//
// A keyword alone cannot decide this: the same word is a collision on one page
// and the correct subject on another. A cosplay photo is wrong on a ramen shop
// and exactly right on a Comiket page — which is how the Comiket post (hero
// vision-verified MATCH, "cosplay IS Comiket culture", 2026-08-09) still came up
// as a mismatch in every night's validate run. So each blocked token carries the
// article context that makes it ON-topic; without a match there, the token still
// blocks. False positives are expensive here: backfill-venue-photos sorts flagged
// heroes FIRST, so a wrongly-flagged hero gets a correct photo replaced.
const TOKENS = [
  { re: /_MHNT|\bAmbulyx\b|\bTheretra\b|Sphingidae|Lepidoptera/i },
  { re: /Dune_bashing/i, onTopic: /dune bash|desert safari/i },
  { re: /\bambulance\b/i, onTopic: /\bambulance|paramedic/i },
  { re: /U\.?S\.?_?Navy|Vice[_-]?Admiral|_admiral/i, onTopic: /\bnavy|naval|warship|maritime museum/i },
  { re: /Orphanage/i, onTopic: /orphanage/i },
  { re: /cosplay|SMASH_20/i, onTopic: /cosplay|comiket|comic ?market|comic ?con|anime|manga|doujin/i },
  { re: /British_Museum/i, onTopic: /british museum/i },
  { re: /_inscription|inscription_from/i, onTopic: /inscription|epigraph|stele/i },
  { re: /Google_Art_Project/i },
  { re: /geograph\.org\.uk/i },
  { re: /Oxomoco/i, onTopic: /oxomoco/i },
  { re: /Ketchikan/i, onTopic: /ketchikan/i },
  { re: /_Glencoe/i, onTopic: /glencoe/i },
];

// Kept for callers that only have a filename and no article context. Matching
// this is "suspect", not "off-topic" — prefer offTopicToken() where the title
// is available.
export const OFFTOPIC = new RegExp(TOKENS.map((t) => t.re.source).join('|'), 'i');

// The first blocked token that the article context does NOT excuse, or null when
// the hero is fine. `context` should be the article's own subject — title, place
// name, region — never its body, which mentions far too much to be evidence.
export function offTopicToken(hay, context = '') {
  for (const t of TOKENS) {
    if (!t.re.test(hay)) continue;
    if (t.onTopic && t.onTopic.test(context)) continue;
    return t.re.source;
  }
  return null;
}

// True when a hero image is unusable for a card. Missing images and placeholders
// are always unusable. Only Wikimedia heroes carry keyword-collision risk;
// google-places / unsplash / kto-open are curated and always pass.
export function isOffTopicHero(hero, context = '') {
  if (!hero || !hero.url) return true;
  if (hero.license === 'placeholder') return true;
  if (hero.license !== 'wikimedia') return false;
  const hay = decodeURIComponent(hero.url) + ' ' + (hero.credit || '');
  return offTopicToken(hay, context) !== null;
}
