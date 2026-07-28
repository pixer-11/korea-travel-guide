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

export const PROSE_GUARD_PATTERNS = [
  { name: 'clock-time-ampm', re: /\b\d{1,2}\s*(:\d{2})?\s*(am|pm)\b/i },
  { name: 'clock-time-24h', re: /\b\d{1,2}:\d{2}\b/ },
  {
    name: 'hours-language',
    re: /\bopening hours\b|\bopens?\s+(at|from|around)\b|\bcloses?\s+(at|on|around)\b|\bclosed\s+(on|every|each)\b|\bopen\s+(until|till|late|24\s*hours|round the clock)\b|\blast\s+(entry|admission|order)\b/i,
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
