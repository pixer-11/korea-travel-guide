// The Event schema's `name` is the EVENT's name — not the article's headline.
// Event titles are built by discover-events.mjs as "<event>: What to Know (<city>)",
// so the article suffix has to come off before it ships as structured data:
// Google prints `name` verbatim in the event card, and 257 nodes were advertising
// "Lollapalooza 2026: What to Know (Chicago)" as if that were the festival's
// name (found 2026-08-06).
//
// Derived from the ENGLISH title on purpose. The localized titles are free
// translations — "2026年芝加哥Lollapalooza音乐节指南", "라 메르세 축제: 알아야 할 모든 것",
// "ラ・トマティーナ完全ガイド(ブニョール)" — with no shared separator to cut on, so any
// rule over them would leave "가이드"/"指南"/"完全ガイド" inside the event's name.
// A proper-noun event name in its original spelling beats a localized headline
// that is not the event's name at all.

// Everything from the article-suffix separator onward. The separator may be a
// colon or a dash, and the tail may end "(City)" or "in City" — all four
// combinations occur in the corpus.
const ARTICLE_SUFFIX = new RegExp(
  String.raw`\s*[:\u2013\u2014-]\s*(?:What to Know|A Visitor(?:'s)? Guide|Complete Guide|Ultimate Guide|Dates,? Tickets)\b.*$`,
  'i',
);

// Leftover separators/whitespace once the suffix is gone.
const TRAILING_JUNK = new RegExp(String.raw`[\s:\u2013\u2014-]+$`);

/**
 * The event's own name, extracted from an English article title.
 * Titles with no article suffix ("Mud Festival in Boryeong") pass through
 * unchanged, and a title that is *only* a suffix falls back to itself rather
 * than emitting an empty name.
 */
export function eventSchemaName(title) {
  const raw = String(title ?? '').trim();
  const cut = raw.replace(ARTICLE_SUFFIX, '').replace(TRAILING_JUNK, '').trim();
  return cut || raw;
}

// The PROPER NAME to search image archives for — the act, the tournament, the
// convention — with the tour branding, the edition year and the parenthetical
// stripped off.
//
// Wikimedia Commons genuinely has photos of most of these acts and events; the
// pipeline simply never asked for them by name. It searched the full title,
// then a single anchor word, and both miss:
//
//   "Post Malone – BIG ASS World Tour" → a 1921 city directory, an 18th-century
//                                        book of vignettes
//   anchor "malone"                    → Malone, New York (a road photo)
//   "Post Malone"                      → Post Malone, on stage
//
//   "EuroVolley Women 2026 (Final Stage)" → "EuroVolley Women" finds CEV
//                                            EuroVolley match photography
//
// Every quarantined event this was tested against had usable imagery sitting
// one query away (2026-08-07).
export function eventProperName(title) {
  const base = eventSchemaName(title);
  // Cut at the first separator that introduces branding or a sub-title:
  // an en/em dash, a colon, or an opening bracket.
  const head = base.split(/\s[–—-]\s|:\s|\s*[(（]/)[0] || base;
  const raw = head.split(/\s+/).filter(Boolean);
  const words = raw.filter((w, i) => {
    if (/^(19|20)\d{2}$/.test(w)) return false;        // an edition year, wherever it sits
    if (/^\d{1,3}(st|nd|rd|th)$/i.test(w)) return false; // "108th", "3rd"
    // A BARE number is an edition only at the END ("Comiket 108"). In the
    // middle it belongs to the name — dropping it turned "Formula 1 Spanish
    // Grand Prix" into "Formula Spanish Grand Prix", which matches nothing.
    if (/^\d{1,3}$/.test(w) && i === raw.length - 1) return false;
    return true;
  });
  // Five words: "Formula 1 Spanish Grand Prix" is exactly that long and is the
  // string Commons matches (a four-word cut to "…Spanish Grand" is a weaker
  // query). Long enough for the real names, short enough that the archive
  // still returns something.
  const name = words.slice(0, 5).join(' ').replace(TRAILING_JUNK, '').trim();
  return name || base;
}

// Search variants of the proper name. Our titles store some acts camel-cased
// ("LeeHi") while Commons files spell them spaced ("Lee Hi …") and its search
// does not bridge the two — the proper-name query returned nothing while five
// CC concert photos sat one spacing away (2026-08-09). The camel-split form is
// an ADDITIONAL query, never a replacement: "EuroVolley" is genuinely written
// solid and splitting it in place broke its (working) query.
export function eventProperNameVariants(title) {
  const name = eventProperName(title);
  const spaced = name.replace(/\b([A-Z][a-z]{2,})([A-Z][a-z]+)\b/g, '$1 $2');
  return spaced !== name ? [name, spaced] : [name];
}
