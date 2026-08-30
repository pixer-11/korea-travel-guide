// ─────────────────────────────────────────────────────────────
//  ENDED-EVENT CLAIM PATTERNS — one jury for the audit and the repair
//
//  An event guide is written before the event. Once it is over, two opposite
//  failures are possible, and this file is the single definition of both, so
//  that validate-content.mjs (which finds them) and fix-ended-event-tense.mjs
//  (which repairs them) can never disagree about what counts.
//
//  They disagreed until 2026-08-22: each had its own copy-pasted FUTURE_PROMISE
//  and the validator's had quietly grown a branch ("once they're released") the
//  repair tool did not know about. That is the same shape as the hero-url bug
//  on 2026-08-19 — audit fixed, prevention left blind.
// ─────────────────────────────────────────────────────────────

// (1) The page still promises something WILL happen. Deliberately narrow: it
// must promise a future act OF THE EVENT. A timeless descriptive future
// ("street circuits mean the cars will run through the city") is not flagged.
//
// Widened 2026-08-30. The evening patrol repaired two ended events and the
// validator then called the corpus clean while ten more still told the reader to
// wait for news about something already over — Tokyo's E-Prix said "once the
// venue is confirmed", Jakarta's festival "once sales open", Chandigarh's tour
// "wait for the official announcement". Each was the same promise in a shape the
// pattern happened not to know: "once released" was here, "once it's released"
// was not. The five branches below are the shapes the corpus actually contained.
//
// Three more shapes were measured that evening and left OUT on purpose, because
// on an ended event they are not promises at all:
//  · "reconfirm on official channels before booking" — 27 of the 45 ended events
//    say it, and 25 of the 45 recur annually, so it is still true and still the
//    most useful line on the page.
//  · "confirm which days are public-access" — a promise only to a regex.
//  · "check back" — indistinguishable from the next-edition pointer that earns a
//    returning reader, and deleting that costs more than the stale phrasing does.
export const FUTURE_PROMISE = /\b(tickets\s+(?:go|will go)\s+on\s+sale|(?:the\s+)?(?:full\s+)?lineup\s+(?:will|has yet to|have yet to)\b|will\s+be\s+(?:announced|confirmed|revealed|published|released)|is\s+expected\s+to\s+be\s+(?:announced|confirmed)|once\s+(?:released|published|announced|confirmed|they'?re?\s+released)|once\s+(?:it'?s|they'?re|the\s+[\w' -]{1,30}\s+(?:is|are))\s+(?:released|announced|confirmed|published|revealed|locked\s+in)|once\s+(?:ticket\s+)?sales\s+open|wait\s+for\s+[^.\n]{0,50}?\b(?:announcement|announced|confirmation)\b|nearer\s+the\s+time|TBA|TBC|to\s+be\s+(?:announced|confirmed|revealed)|closer\s+to\s+the\s+(?:event|date|festival|show)|(?:haven'?t|hasn'?t|weren'?t|wasn'?t)\s+been\s+(?:announced|confirmed|released)|yet\s+to\s+be\s+(?:announced|confirmed|released)|expect\s+(?:the\s+)?(?:full\s+)?(?:lineup|set times|schedule)[^.]{0,40}\bto\s+drop\b)/i;

// (2) The mirror image, and the worse one: the page claims it DID happen.
//
// On 2026-08-22 fifteen live guides carried "Ticket and set-time details were
// published on the official site" — a thing nobody here ever checked. Jakarta's
// contradicted itself inside one paragraph: "Prices had not been announced
// ahead of time. Presale and ticket-tier details were published on the official
// site." The cause was not the model. The repair prompt offered that exact
// sentence as the model answer for "check the official site closer to the
// date", two lines above its own "NEVER invent what happened", and the model
// did as it was told.
//
// Narrow on purpose — it must be an unsourced pointer at an "official" channel.
// The dot class allows an abbreviation (UFC.com) but not a sentence end, so a
// match cannot run past the full stop into the next sentence.
// A dated, sourced claim ("the lineup was announced on July 1") carries a fact
// and is left alone; so is "tickets were sold through official channels".
export const FABRICATED_AVAILABILITY = /\b(?:was|were)\s+(?:published|announced|released|posted)\s+(?:on|through|via)\s+(?:[^.\n]|\.(?=\S)){0,40}\bofficial\b/i;

// What a repaired ended-event page may not say, either way round. The repair
// tool tests its own output against this, so a rewrite that trades a future
// promise for an invented past one is rejected and retried, not written out.
export const OFFENDING_CLAIM = new RegExp(`${FUTURE_PROMISE.source}|${FABRICATED_AVAILABILITY.source}`, 'i');
