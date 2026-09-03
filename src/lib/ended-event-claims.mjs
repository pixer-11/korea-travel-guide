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

// (3) The page admits it does not know WHERE the event is, and then tells the
// reader which station to get off at anyway.
//
// Found 2026-08-31 by a Codex content audit and confirmed against the official
// listing: our Lang Lang guide put the concert in Tashkent, gave Tashkent metro
// directions, and said in its own FAQ that "no single venue is officially
// fixed". The concert is at Registan Square in SAMARKAND, 270km away. A reader
// following that page would have travelled to the wrong city.
//
// The pair is what makes it a defect, and both halves matter:
//   · admitting the venue is unknown is HONEST on its own — Wuhan's snooker
//     guide says exactly that and then gives only city-level transit, which is
//     the right way to write an unconfirmed event. It must not be flagged.
//   · naming a station and a walk is fine on its own — that is what a guide to
//     a confirmed venue does.
// Only together do they mean: we guessed, and we dressed the guess as directions.
//
// Measured over 129 event guides: 1 match, the Lang Lang page. The four posts
// that hedge honestly all pass.
export const VENUE_UNCONFIRMED = /no single venue is officially fixed|no (?:official )?venue (?:has been )?(?:announced|confirmed|fixed)|venue[^.]{0,45}(?:not|yet to be)[^.]{0,25}(?:been )?(?:confirmed|announced|fixed)/i;

// A named destination — "metro to X Station", "to Y Station, a short walk" —
// not the generic "the city has a metro", which is legitimate on any page.
export const NAMED_DIRECTIONS = /(?:metro|subway|train|bus) to [A-Z][\w'\u2019-]+(?:\s[A-Z][\w'\u2019-]+)*\s*(?:station|Station|Maydoni|Xiyoboni)|to [A-Z][\w'\u2019-]+ [Ss]tation,? (?:both |each )?a (?:short|\d+[- ]minute)/;

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
// A promise anchored to a calendar month is still a promise. "Check the official
// page closer to July 2026" is "closer to the date" with the date filled in, and
// the 2026-09-02 audit found nine ended events still saying it (Tokyo's E-Prix,
// Phu Quoc's flute festival, Wuhan's snooker, Da Nang's Airtime Asia...) while
// the rule reported clean, because it only knew "closer to the date/event/
// festival/show". The month may carry a year ("August 2026"), a qualifier
// ("mid-July"), or stand alone ("closer to August"). It may NOT be followed by
// a day number: Aomori's Nebuta guide says "the earlier evenings in the run
// (closer to August 2-3) tend to be quieter", which describes the calendar and
// promises nothing. "nearer the time" gets the same month form for symmetry.
// The pattern is built from a template only so MONTH can be spliced in twice.
const MONTHNAME = String.raw`(?:January|February|March|April|May|June|July|August|September|October|November|December)`;
const MONTH = String.raw`(?:(?:early|mid|late)[-\s])?${MONTHNAME}(?:\s+\d{4})?\b(?!\s*\d)`;
// What an instruction may be anchored to and still be a promise: a TIME. Never a
// place ("the station entrance closer to the stadium"), never a clock reading
// ("in summer that's closer to 9pm" - barcelona-mirador-torre-glories, live; a Codex
// review found both of those flagged on 2026-09-03). The dated form ("the July
// 25-26, 2026 date") is Tokyo's E-Prix FAQ, and it needs a date noun after the
// numbers so Aomori's "(closer to August 2-3) tend to be quieter" - numbers followed
// by prose - stays a description of the calendar.
// A time noun followed by a spatial head is a place again: "the event venue",
// "the show grounds", "the start line" (Codex second pass, 2026-09-03).
const NOT_SPATIAL = String.raw`(?!\s+(?:venue|grounds?|line|site|area|entrance|gate|hall|stage|zone|district|precinct|village|park|square|centre|center|arena|stadium|circuit))`;
const TIME = String.raw`(?:the\s+)?(?:date|time|event|show(?:time)?|festival|race(?:\s+weekend)?|weekend|kick-?off|start|opening|\d{1,2}(?:st|nd|rd|th)\b|${MONTH}|${MONTHNAME}\s+\d{1,2}(?:\s*[-–]\s*\d{1,2})?(?:,\s*\d{4})?\s+(?:date|event|show|weekend|race))${NOT_SPATIAL}`;
// Two more shapes, 2026-09-02 evening, both from Tokyo's E-Prix FAQ after the
// month-anchor repair had already run on that page: "haven't been officially
// detailed yet. Check the official Formula E website closer to the July 25-26,
// 2026 event". The negated-past branch knew only announced/confirmed/released
// and no adverb; and the month branch's day-number guard, which exists so that
// Aomori's "(closer to August 2-3) tend to be quieter" stays clean, also let a
// dated instruction through. So: an imperative (check / confirm / verify /
// watch / see) followed within a sentence by "closer to" / "nearer (to)" and a
// TIME object is a promise - the imperative makes it an instruction, the time
// object makes it one the reader can no longer follow. The first cut (09-02)
// took any "closer to" after an imperative and flagged "use the station
// entrance closer to the stadium"; requiring a TIME (see above) fixes that and
// leaves "closer to your visit" out by construction - that is the READER's
// date, and on the annual festivals that say it (Boryeong, Qingdao, Taitung)
// the advice stays true every year.
// The passive shape is the same promise with the organizer as subject: "exact
// set times are published closer to showtime", "details are usually published
// by organizers closer to race weekend" (Milan A$AP Rocky, Bol d'Or - both
// missed until the 09-03 review).
// Tense matters for the passive shape and for the bare "closer to the event":
// "The lineup was announced closer to the event than the 2025 lineup" is a
// historical statement, and on an ended event the repair would have deleted
// it. So the passive form takes only non-past auxiliaries (is / are / will be /
// gets / usually…), and the bare forms carry a lookbehind that refuses a past
// auxiliary within three words before "closer to" (Codex second pass).

export const FUTURE_PROMISE = new RegExp(String.raw`\b(tickets\s+(?:go|will go)\s+on\s+sale|(?:the\s+)?(?:full\s+)?lineup\s+(?:will|has yet to|have yet to)\b|will\s+be\s+(?:announced|confirmed|revealed|published|released)|is\s+expected\s+to\s+be\s+(?:announced|confirmed)|once\s+(?:released|published|announced|confirmed|they'?re?\s+released)|once\s+(?:it'?s|they'?re|the\s+[\w' -]{1,30}\s+(?:is|are))\s+(?:released|announced|confirmed|published|revealed|locked\s+in)|once\s+(?:ticket\s+)?sales\s+open|wait\s+for\s+[^.\n]{0,50}?\b(?:announcement|announced|confirmation)\b|(?<!\b(?:was|were|had\s+been|has\s+been|have\s+been)\s+(?:[\w'-]+\s+){0,3})nearer\s+(?:the\s+(?:time|date)|(?:to\s+)?${MONTH})${NOT_SPATIAL}|TBA|TBC|to\s+be\s+(?:announced|confirmed|revealed)|(?<!\b(?:was|were|had\s+been|has\s+been|have\s+been)\s+(?:[\w'-]+\s+){0,3})closer\s+to\s+(?:the\s+(?:event|date|festival|show)|${MONTH})${NOT_SPATIAL}|\b(?:check|confirm|verify|watch|see|recheck|re-check)\b[^.\n]{0,80}\b(?:closer\s+to|nearer(?:\s+to)?)\s+${TIME}\b|(?<!\b(?:was|were)\s+)\b(?:is|are|will\s+be|should\s+be|may\s+be|might\s+be|can\s+be|could\s+be|gets?|usually|typically|often|normally|generally)\s+(?:(?:usually|typically|often|normally|generally|only)\s+)?(?:published|announced|released|confirmed|posted|shared|finali[sz]ed)\b[^.\n]{0,40}\b(?:closer\s+to|nearer(?:\s+to)?)\s+${TIME}\b|(?:haven'?t|hasn'?t|weren'?t|wasn'?t)\s+been\s+(?:(?:officially|publicly|formally|fully)\s+)?(?:announced|confirmed|released|detailed|finali[sz]ed|set|fixed|decided|locked\s+in|published)|(?:won'?t|will\s+not)\s+be\s+(?:known|announced|confirmed|decided|determined|revealed|set|published|released)|yet\s+to\s+be\s+(?:announced|confirmed|released)|expect\s+(?:the\s+)?(?:full\s+)?(?:lineup|set times|schedule)[^.]{0,40}\bto\s+drop\b)`, 'i');

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
// Widened 2026-09-02: the month-anchor repair turned "check letour.fr closer to
// July 2026" into "the stage towns … were confirmed by the official Tour de
// France website" — the same invented past in a shape ("confirmed by") the
// pattern did not know, so the repair tool accepted its own fabrication.
// And the model, told the phrase must not survive, reached for a synonym twice
// in the same run: "had been confirmed on the official", "were listed on the
// official". A synonym for an unverified claim is the same unverified claim.
export const FABRICATED_AVAILABILITY = /\b(?:was|were|had been|has been|have been)\s+(?:published|announced|released|posted|confirmed|listed|shared)\s+(?:on|through|via|by)\s+(?:[^.\n]|\.(?=\S)){0,40}\bofficial\b/i;

// What a repaired ended-event page may not say, either way round. The repair
// tool tests its own output against this, so a rewrite that trades a future
// promise for an invented past one is rejected and retried, not written out.
export const OFFENDING_CLAIM = new RegExp(`${FUTURE_PROMISE.source}|${FABRICATED_AVAILABILITY.source}`, 'i');
