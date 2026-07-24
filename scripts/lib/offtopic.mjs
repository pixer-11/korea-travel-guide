// Shared "off-topic hero image" guard. A keyword-collision Wikimedia file whose
// subject is clearly unrelated to a venue — a moth specimen, a dune-bashing car,
// US-Navy admirals, a museum statue. Extracted from validate-content.mjs so the
// publish gate AND the newsletter renderer reject the exact same bad heroes.
export const OFFTOPIC = /_MHNT|\bAmbulyx\b|\bTheretra\b|Sphingidae|Lepidoptera|Dune_bashing|\bambulance\b|U\.?S\.?_?Navy|Vice[_-]?Admiral|_admiral|Orphanage|cosplay|SMASH_20|British_Museum|_inscription|inscription_from|Google_Art_Project|geograph\.org\.uk|Oxomoco|Ketchikan|_Glencoe/i;

// True when a hero image is unusable for a card. Missing images and placeholders
// are always unusable. Only Wikimedia heroes carry keyword-collision risk;
// google-places / unsplash / kto-open are curated and always pass.
export function isOffTopicHero(hero) {
  if (!hero || !hero.url) return true;
  if (hero.license === 'placeholder') return true;
  if (hero.license !== 'wikimedia') return false;
  const hay = decodeURIComponent(hero.url) + ' ' + (hero.credit || '');
  return OFFTOPIC.test(hay);
}
