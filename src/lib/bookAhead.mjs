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

const NEGATION = /\b(?:no|not|never|rarely|seldom|little|without|unnecessary|optional|walk-?ins?|isn't|aren't|don't|doesn't|needn't)\b|n't\b/i;

// "rather than" / "instead of" turn on which side of the advice they sit
// (Codex review, 10-01): "pay at the door rather than pre-book" is against
// booking, "book online in advance rather than assuming walk-up entry" (the
// teamLab and Casa Milà guides) is for it.
const CONTRAST = /\b(?:rather than|instead of)\b/gi;

// Booking one optional amenity is not booking the visit: East Coast Park's
// "book a barbecue pit ahead if you want one" put a park walk on the
// checklist (Codex review, 10-01). Only the words inside the matched phrase
// count, so "book a table in advance" at a restaurant still does.
const AMENITY = /\b(?:barbecue|bbq|pits?|chalets?|campsites?|cabanas?|pavilions?|lockers?|bikes?|bicycles?|kayaks?|lanes?|courts?|parking)\b/i;

/** Item labels that only name the line's topic ("- **Tickets**: buy online
 *  in advance…", MACBA), not some other place. */
const LABEL = /^\s*(?:tickets?|ticketing|reservations?|bookings?|entry|admission|getting in|when to book|tips?)\s*:?\s*$/i;

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
      return !m || POSITIVE.test(m[1]) || LABEL.test(m[1]);
    })
    .join('\n')
    .replace(/[*_`#>]/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// The weak negations — "not", "walk-in" — count only in the clause that carries
// the advice: "runs on reservations, not walk-in luck, … book online ahead
// rather than arriving unannounced" is advice (Saladaeng, Codex review 10-01).
// The strong ones count anywhere in the sentence. A clause-only version was
// measured on all guides and took "There's no ticket booth, so there's nothing
// to book in advance" and "there's no metro, so a pre-booked car" for advice —
// 25 wrong of 66 new — and a wrong "book ahead" is worse than a missing one.
const CLAUSE = /[,;:()]|\s[—–-]\s/;
// "skip" only when it is the booking that is skipped: "book online to skip the
// queue" is the commonest advice there is (21 guides lost it to a bare "skip").
// Likewise "nothing" only as "nothing to book": Doge's Palace's "cuts your
// wait to almost nothing" is a reason to book.
const STRONG = /\b(?:no|never|rarely|seldom|little|without|unnecessary|optional|isn't|aren't|don't|doesn't|needn't|won't)\b|n't\b/i;
const DISMISS = /\b(?:not|never|rarely)\s+(?:\w+\s+){0,2}(?:necessary|needed|required|essential)\b|\bnothing to (?:pre-?)?(?:book|reserve)\b|\bskip (?:the idea of )?(?:booking|reserving)\b|\bif you (?:want|'d like|would like) (?:one|to see one|it|them)\b/i;
// Getting there is not getting in: "a pre-booked car / taxi / shuttle".
const TRANSPORT = /^\W*(?:\w+\s+){0,2}(?:cars?|taxis?|cabs?|autos?|shuttles?|pickups?|transfers?|bus(?:es)?|drivers?|tours?|parking)\b/i;

/** True when some sentence recommends booking ahead and nothing in it takes that back. */
export function recommendsBooking(body) {
  return sentences(body).some((s) => {
    const m = POSITIVE.exec(s);
    if (!m || AMENITY.test(m[0]) || STRONG.test(s) || DISMISS.test(s)) return false;
    if (/^pre-?book/i.test(m[0]) && TRANSPORT.test(s.slice(m.index + m[0].length))) return false;
    const clause = s.split(CLAUSE).find((c) => POSITIVE.test(c)) ?? s;
    if (NEGATION.test(clause)) return false;
    // A contrast before the advice argues against it; one after it, for it.
    for (const c of s.matchAll(CONTRAST)) if ((c.index ?? 0) < m.index) return false;
    return true;
  });
}
