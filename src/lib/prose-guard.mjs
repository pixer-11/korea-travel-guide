// Pure, dependency-free scanner for AI-written itinerary/post prose. Facts
// like venue hours and prices must never appear in written prose — the page
// always renders those from structured data (src/lib/itinerary.mjs's solver
// output), never from written text. Shared by scripts/build-itineraries.mjs
// (pre-write guard, with one retry) and scripts/validate-itineraries.mjs (the
// CI/pre-rename gate) so the two implementations can never drift apart.
//
// `hours-language` intentionally matches actual HOURS/OPENING CLAIMS only —
// "opens at 9am", "closes on Sundays", "closed on Tuesdays", "opening hours
// vary", "open until late", "last entry 30 minutes before" — not ordinary
// prose that happens to contain "open"/"close" with no schedule meaning:
// "close to the palace", "an open-air market", "the alley opens onto a
// plaza", "a closed-off pedestrian street". An earlier, broader version of
// this pattern (bare \bopens?\b / \bcloses?\b) false-positived on real
// generated prose for every launch city — see fix-round 2 of the itinerary
// builder review.

// Round 3 (2026-09-09): "opens at" / "closes at" alone is not an hours claim.
// Itinerary prose schedules the DAY in those words — "The day opens at Sultan
// Mosque", "the afternoon closes at Clarke Quay" — and the Singapore 5-day
// rebuild was refused twice for exactly that. What makes it an hours claim is
// the object: a time. So the verb forms below require a time-shaped object
// (a digit, a clock word, a number word) or, for "closes on", a day/period.
// Digits with am/pm or a colon are caught by the clock patterns regardless.
// "night", "all hours", "the clock", seasons and "the usual/same" are in the
// list because a sweep of every post showed the old pattern catching real
// claims of exactly those shapes — "open at night", "open around the clock",
// "open from spring through autumn", "closes at the usual 11:30pm".
const TIME_WORD = String.raw`(?:\d|noon|midday|midnight|dawn|dusk|sunrise|sunset|nightfall|first light|the crack of dawn|night\b|all hours\b|the clock\b|(?:the )?(?:usual|same)\b|(?:early |late |mid-?)?(?:spring|summer|autumn|fall|winter)\b|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b|(?:early|late|mid)[- ]?(?:morning|afternoon|evening)\b)`;
// Grouped as a whole on purpose: ungrouped, "weekends" became a top-level
// alternative and flagged eleven healthy itineraries (caught by comparing the
// validator's count before and after on the live files).
const DAY_WORD = String.raw`(?:(?:mon|tues|wednes|thurs|fri|satur|sun)days?\b|weekends?\b|weekdays?\b|(?:public |bank )?holidays\b|(?:rotating|alternate|several|certain|some|most|the same) days\b)`;

export const PROSE_GUARD_PATTERNS = [
  { name: 'clock-time-ampm', re: /\b\d{1,2}\s*(:\d{2})?\s*(am|pm)\b/i },
  { name: 'clock-time-24h', re: /\b\d{1,2}:\d{2}\b/ },
  {
    name: 'hours-language',
    re: new RegExp(
      String.raw`\bopening hours\b` +
      String.raw`|\bopens?\s+(?:at|from|around)\s+${TIME_WORD}` +
      String.raw`|\bcloses?\s+(?:at|around)\s+${TIME_WORD}` +
      String.raw`|\bcloses?\s+on\s+${DAY_WORD}` +
      String.raw`|\bclosed\s+(?:on|every|each)\b` +
      String.raw`|\bopen\s+(?:until|till|late|24\s*hours|round the clock)\b` +
      String.raw`|\blast\s+(?:entry|admission|order)\b`,
      'i',
    ),
  },
  { name: 'currency-symbol', re: /[$€£¥₩]\s?\d/ },
  { name: 'currency-code', re: /\b\d+\s?(usd|krw|jpy|thb|won|baht|yen)\b/i },
];

// Scans a single string, returning [] (clean) or an array of {pattern} hits.
export function findProseViolations(text) {
  const t = String(text || '');
  const hits = [];
  for (const { name, re } of PROSE_GUARD_PATTERNS) {
    if (re.test(t)) hits.push({ pattern: name });
  }
  return hits;
}
