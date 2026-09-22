// Shared near-duplicate topic key. Normalizes a post's title + region into a
// sorted token key so same-city name variants collapse to one key — e.g.
// "ChinaJoy 2026: What to Know (Shanghai)" and "ChinaJoy: What to Know (Shanghai)"
// both become "chinajoy shanghai". Used by BOTH validate-content.mjs (post-publish
// detection) and discover-events.mjs (generation-time prevention) so the two rules
// can never drift apart. Region is included so different cities that share a
// generic noun ("Tower", "Local Restaurant") do NOT collapse.
export const FILLER = new Set(['the', 'and', 'with', 'what', 'know', 'guide', 'visitor', 'visitors', 'where', 'eat', '2026', '2027']);

export const topicKey = (title, region) => {
  // "Dates, Tickets" is the event suffix in use since 2026-08-07; "What to
  // Know" covers the back catalogue. Both must strip to the same key or a
  // re-discovered event would dodge the duplicate guard across the rename.
  const name = String(title).split(/:\s*(?:What to Know|Where to Eat|A Visitor|Dates, Tickets)/i)[0];
  // …and drop a parenthetical alias. A venue whose second name is carried in
  // brackets keys on the brackets: "House of Tan Yeok Nee (Loca Niru, Bar Kap
  // & Jing Studio)" shares nothing with "House of Tan Yeok Nee" once eight
  // extra tokens are in the sort. Measured over 1,945 posts this collapses
  // exactly one further pair, and that pair is the twin above — no distinct
  // venue merges. The event suffix "(Bangkok)" is already gone by here.
  const bare = name.replace(/\([^)]*\)/g, ' ');
  // Latin letters carrying diacritics must survive as letters. Stripping every
  // non-ASCII character outright turned "Bếp Cuốn Đà Nẵng" into fragments too
  // short to keep, leaving a key made only of the REGION — which is how it
  // matched "Ăn Thôi", a different restaurant a kilometre away, the first time
  // this key was asked about Vietnam (2026-09-22).
  const words = (text) => text
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd').replace(/[øØ]/g, 'o').replace(/[łŁ]/g, 'l')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !FILLER.has(w));
  // A script this key cannot read at all — Japanese, Chinese, Korean, Thai —
  // leaves NOTHING of the name, and a key made of the region alone says only
  // "these two are in the same city". That is not a duplicate; it is every
  // post in the city. No name, no key: callers all treat an empty key as
  // "cannot judge this one" and move on.
  const nameWords = words(bare);
  if (!nameWords.length) return '';
  // A Set, not a plain list: repeated words must collapse, or one venue keys
  // two different ways. Google returned the same Sangenjaya cafe as "SAMAA_"
  // and, six days later, as "Samaa (SAMAA_)"; the alias repeats the name, so
  // the two sorted token lists differed by one word and the duplicate guard
  // let the twin through. Same shape when the region name is repeated inside
  // the venue name ("Dubai Marina Walk" in Dubai Marina).
  return [...new Set([...nameWords, ...words(String(region))])].sort().join(' ');
};
