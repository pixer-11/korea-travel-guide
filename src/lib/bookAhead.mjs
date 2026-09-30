// Does a place's own (vetted) guide tell the reader to book ahead?
//
// The itinerary page marks such stops "book ahead" and lists them in a
// checklist. There is no structured field for it, so it is read from the
// guide's English body — sentence by sentence, because the first version
// matched the phrase anywhere and flagged guides that say the OPPOSITE:
// "No advance booking is needed", "rarely a need to book ahead", "rather than
// pre-booked" (review 2026-09-30: LA's and Busan's lists were entirely wrong).
// A sentence counts only if it recommends booking and carries no negation.

const POSITIVE = new RegExp([
  String.raw`timed[- ]entry`,
  String.raw`timed (?:[\w'-]+ )?tickets?`,
  String.raw`book(?:ing)? (?:[\w'-]+ ){0,5}?(?:online )?(?:well )?(?:in advance|ahead)`,
  String.raw`buy (?:[\w'-]+ ){0,4}?online (?:well )?(?:in advance|ahead)`,
  String.raw`advance (?:online )?(?:booking|reservations?|tickets?)`,
  String.raw`reservations? (?:are |is )?(?:required|essential|strongly recommended|recommended)`,
  String.raw`pre-?book`,
  // Not "sells out": in these guides it is the pastries and the market
  // stalls that sell out (Fuglen, Tsukiji, Ralph's), not a ticket.
].join('|'), 'i');

const NEGATION = /\b(?:no|not|never|rarely|seldom|little|without|unnecessary|optional|rather than|walk-?ins?|isn't|aren't|don't|doesn't|needn't)\b|n't\b/i;

/** Sentences of a markdown body, headings and list markers stripped.
 *  A list item that opens with a bold NAME ("- **Shibuya Sky**, a rooftop
 *  deck… best booked online") describes some other place — the crossing
 *  itself needs no ticket — so it is left out, unless the bold words are
 *  themselves the advice ("- **Book ahead online.** …"). */
function sentences(body) {
  return String(body || '')
    .split('\n')
    .filter((line) => {
      const m = /^\s*[-*]\s+\*\*([^*]+)\*\*/.exec(line);
      return !m || POSITIVE.test(m[1]);
    })
    .join('\n')
    .replace(/[*_`#>]/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True when some sentence recommends booking ahead and none of its words negate it. */
export function recommendsBooking(body) {
  return sentences(body).some((s) => POSITIVE.test(s) && !NEGATION.test(s));
}
