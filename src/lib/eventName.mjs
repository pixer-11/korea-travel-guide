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
  String.raw`\s*[:\u2013\u2014-]\s*(?:What to Know|A Visitor(?:'s)? Guide|Complete Guide|Ultimate Guide)\b.*$`,
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
