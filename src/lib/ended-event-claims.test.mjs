import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FUTURE_PROMISE, FABRICATED_AVAILABILITY, OFFENDING_CLAIM, ADVICE_IMPERATIVE } from './ended-event-claims.mjs';

// The defect: on 2026-08-22 fifteen live guides claimed details "were published
// on the official site" — invented by the repair prompt's own worked example.
test('flags the invented-past claim the repair prompt used to teach', () => {
  for (const s of [
    'Ticket and set-time details were published on the official site.',
    'Presale and ticket-tier details were published on the official Sounds Project site and social media.',
    'the confirmed 2026 Osaka venue was published on the official site',
    "details were published on UFC.com or Ticketmaster, UFC's official channels",
    'Exact match dates, kickoff times, and ticket release details were published on the official Hong Kong Football Festival and Kai Tak Stadium channels.',
  ]) assert.ok(FABRICATED_AVAILABILITY.test(s), s);
});

// Reverse direction: a repair that removes real reporting is worse than the
// defect. A sourced claim carries a fact and must survive untouched.
test('leaves sourced or unrelated past tense alone', () => {
  for (const s of [
    'The lineup was announced on July 1, 2026.',
    'The lineup was announced on July 1. The official site listed set times.',
    'Tickets were sold through official channels.',
    'Street circuits mean the cars will run through the city.',
    'Gates opened at 4pm and the festival ran until midnight.',
  ]) assert.ok(!FABRICATED_AVAILABILITY.test(s), s);
});

// A match may not run past a full stop into the next sentence; an abbreviation
// (UFC.com) is not a full stop.
test('does not cross a sentence boundary', () => {
  assert.ok(!FABRICATED_AVAILABILITY.test('Doors were announced on time. The official programme sold out.'));
});

test('still catches the forward-looking half', () => {
  for (const s of [
    'Check the official site closer to the date.',
    'The full lineup will be announced soon.',
    "Book once they're released.",   // the branch the repair tool's copy had never learned
  ]) assert.ok(FUTURE_PROMISE.test(s), s);
});

// Both halves must reach the repair tool through one union, or a rewrite can
// swap one failure for the other and still pass its own check.
test('the union covers both halves', () => {
  assert.ok(OFFENDING_CLAIM.test('Check the official site closer to the date.'));
  assert.ok(OFFENDING_CLAIM.test('Ticket details were published on the official site.'));
  assert.ok(!OFFENDING_CLAIM.test('The festival ran for three days across two venues.'));
});

// ─── 2026-08-30 ────────────────────────────────────────────────────────────
// The rule fixed two ended events that evening and left ten standing. Every
// survivor was a shape of "go and find out later" the pattern had never been
// taught, so validate-content reported clean over pages that still told the
// reader to wait for news about a thing that was already over. The sentences
// below are verbatim from those ten guides — not invented examples, so a later
// narrowing of the rule fails here rather than in production.
test('catches the ways a page tells the reader to wait that the rule had missed', () => {
  for (const s of [
    "Check Quick Style's official channels for the venue once it's released.",
    'So once the venue is confirmed, check its normal entry patterns.',
    'Pick a connected area so you can adjust easily once the exact location is announced.',
    'Check the schedule once the official program is released.',
    "Use the festival's official ticketing partner once sales open.",
    'Buy through verified announcements once ticket sales open, and avoid resellers.',
    "Don't book hotels assuming a specific arena — wait for the official announcement.",
    'Wait for the official ticketing partner to be announced through verified channels.',
    'Exact street circuit location to be confirmed.',
    'Treat this as the announced window and check the official site nearer the time.',
  ]) assert.ok(FUTURE_PROMISE.test(s), s);
});

// The reverse direction, and the reason this rule stayed narrow. Twenty-seven of
// the forty-five ended events say some version of "reconfirm on official
// channels before booking" — and twenty-five of the forty-five recur every year,
// so that sentence is still true and still useful. Deleting it would cost a
// returning reader the only pointer the page has. Two more shapes were measured
// and deliberately left out: "which days are public-access" reads as a promise
// only to a regex, and "check back" cannot be told apart from the next-edition
// pointer that earns the revisit.
test('leaves standing advice on an ended event alone', () => {
  for (const s of [
    'Reconfirm timing, lineup, and ticket prices on official channels before you finalize travel.',
    'Check the schedule and any changes on the official Aomori Nebuta Matsuri website before booking travel.',
    'Confirm which days are public-access on the official site.',
    'Check back for the 2027 dates once the calendar firms up.',
    'The parade route is fixed year to year, so the same vantage points work.',
  ]) assert.ok(!FUTURE_PROMISE.test(s), s);
});

// ─── 2026-08-31 ────────────────────────────────────────────────────────────
// A third claim shape: the page admits it does not know WHERE the event is and
// then tells the reader which station to get off at. Our Lang Lang guide put
// the concert in Tashkent, gave Tashkent metro directions, and said in its own
// FAQ that no venue was officially fixed — the concert was at Registan Square
// in Samarkand, 270km away.
//
// Only the PAIR is a defect, so both directions are fixtures here, taken
// verbatim from the two posts involved.
import { VENUE_UNCONFIRMED, NAMED_DIRECTIONS } from './ended-event-claims.mjs';

const guessed = (text) => VENUE_UNCONFIRMED.test(text) && NAMED_DIRECTIONS.test(text);

// tashkent-lang-lang-in-concert: the concert was in Samarkand.
const LANG_LANG = `
  a: No single venue is officially fixed in public listings, but Tashkent's major
     classical concerts are typically held at the Uzbekistan State Conservatory's concert hall.
  a: Take the Tashkent metro to Mustaqillik Maydoni or Amir Temur Xiyoboni station,
     both a short walk from Amir Timur Square.
`;

// wuhan-2026-wuhan-open-snooker: the same admission, written honestly.
const WUHAN = `
  a: The specific venue in Wuhan had not been confirmed in official sources at the time of writing.
  a: Wuhan has an extensive metro network plus high-speed rail links to major Chinese
     cities and an international airport.
`;

test('the Lang Lang shape is caught: unknown venue, named station anyway', () => {
  assert.equal(guessed(LANG_LANG), true);
});

test('an honest admission with city-level transit is NOT caught', () => {
  assert.equal(VENUE_UNCONFIRMED.test(WUHAN), true, 'it does admit the venue is unknown');
  assert.equal(NAMED_DIRECTIONS.test(WUHAN), false, 'but it names no station to walk from');
  assert.equal(guessed(WUHAN), false);
});

test('directions alone are fine — that is what a confirmed venue reads like', () => {
  const confirmed = 'Take the metro to Ueno Station, a short walk from the main gate.';
  assert.equal(NAMED_DIRECTIONS.test(confirmed), true);
  assert.equal(guessed(confirmed), false);
});

test('an admission alone is fine — saying "we do not know yet" is the right answer', () => {
  const honest = 'The venue has not been announced yet; check the promoter before booking.';
  assert.equal(VENUE_UNCONFIRMED.test(honest), true);
  assert.equal(guessed(honest), false);
});

test('the venue patterns are not sticky between calls', () => {
  // A /g flag would make every second call answer differently and let half the
  // corpus through by accident.
  assert.equal(VENUE_UNCONFIRMED.global, false);
  assert.equal(NAMED_DIRECTIONS.global, false);
  assert.equal(guessed(LANG_LANG), true);
  assert.equal(guessed(LANG_LANG), true);
});

// ─── 2026-09-02 ────────────────────────────────────────────────────────────
// A promise anchored to a calendar month is still a promise. The rule knew
// "closer to the date" but not "closer to July 2026", so the 09-02 audit found
// nine ended events telling readers to check back in a month already past.
// Fixtures are verbatim from those guides.
test('a promise anchored to a month is the same class as "closer to the date"', () => {
  for (const s of [
    'The safest approach is to check the official Formula E Tokyo E-Prix event page closer to July 2026 for the specific loop.',
    "Check Airtime Asia's official website and social channels closer to August 2026, and re-check accommodation availability.",
    "Confirm show timing on the official ticketing page closer to August 2026.",
    "Exact set times aren't set yet, so check official updates closer to August",   // no year
    'check the official championship page closer to August for confirmed access routes.',
    'CHECK THE OFFICIAL PAGE CLOSER TO SEPTEMBER 2026.',   // case-insensitive
    'closer to September',
    'closer to mid-July',
    'check the promoter nearer to August 2026',
    'check the promoter nearer August',
  ]) assert.ok(FUTURE_PROMISE.test(s), s);
});

// The reverse direction: "closer to" is mostly a spatial or descriptive phrase
// in this corpus (26× "closer to an hour", 15× "closer to yourself"), and a
// month followed by a day number describes the calendar, not a page update.
test('"closer to" a place, a quantity, or a dated span is not a promise', () => {
  for (const s of [
    'The earlier evenings in the run (closer to August 2-3) tend to be somewhat quieter.',   // aomori-aomori-nebuta-matsuri
    'Pick a hotel closer to the city center.',
    'Stay closer to the venue if you want to walk.',
    'Budget closer to an hour for the queue.',
    'Hold the umbrella closer to yourself in the crowd.',
    'Rates climb closer to the season.',
    'The stand is closer to the main entrance.',
    'The hotel is closer to Mayfair than to Soho.',   // a month name inside a word
    'The stop nearer Ho Chi Minh Square is quieter.',
  ]) assert.ok(!FUTURE_PROMISE.test(s), s);
});

test('the month branch reaches the repair tool through the union too', () => {
  assert.ok(OFFENDING_CLAIM.test('Check the official page closer to July 2026.'));
  assert.ok(!OFFENDING_CLAIM.test('The earlier evenings (closer to August 2-3) tend to be quieter.'));
});

// The month-anchor repair on 2026-09-02 traded "check letour.fr closer to July
// 2026" for "the stage towns … were confirmed by the official Tour de France
// website" — an invented past in a shape the fabrication rule did not know, so
// the repair tool passed its own fabrication. Verbatim from that rewrite.
test('"were confirmed by the official …" is the invented past too', () => {
  assert.ok(FABRICATED_AVAILABILITY.test('The finalized stage towns, Paris circuit, and any timing changes were confirmed by the official Tour de France website, letour.fr.'));
  assert.ok(OFFENDING_CLAIM.test('Gate times were confirmed by the official venue page.'));
  for (const s of [
    'with the exact 2026 circuit confirmed on the official site.',   // no was/were — a hedge, not a claim
    'The route was confirmed by the mayor on July 1.',                // sourced, not "official channels"
    'letour.fr, the official Tour de France website, is the authority for the stage towns.',
  ]) assert.ok(!FABRICATED_AVAILABILITY.test(s), s);
});

// Told that "were confirmed by the official" must not survive, the model reached
// for a synonym twice in the same run. Verbatim from those two rewrites, plus
// the "shared via" shape the Honne guide carried.
test('a synonym for an unverified claim is the same unverified claim', () => {
  for (const s of [
    'Specific match days and kickoff times had been confirmed on the official festival site.',
    'Exact doors/showtime for the August 7, 2026 date were listed on the official ticket page.',
    "further specifics were shared via HONNE's official social media and the local promoter's announcements.",
  ]) assert.ok(FABRICATED_AVAILABILITY.test(s), s);
  for (const s of [
    'Tickets were sold through official channels.',
    'The official programme listed set times.',
  ]) assert.ok(!FABRICATED_AVAILABILITY.test(s), s);
});

// ─── 2026-09-02, evening ───────────────────────────────────────────────────
// Tokyo's E-Prix FAQ, live after the month-anchor repair had run on the page:
// two shapes in one answer that the rule still did not know.
test('"haven\'t been officially detailed" and "check … closer to the July 25-26" are promises', () => {
  const tokyo = "The precise street circuit layout and district haven't been officially detailed yet. Check the official Formula E website closer to the July 25-26, 2026 event for the specific loop.";
  assert.ok(FUTURE_PROMISE.test(tokyo));
  for (const s of [
    "The layout hasn't been officially detailed yet.",
    "The venue hasn't been finalised.",
    "Set times haven't been fixed.",
    "The route hasn't been publicly set.",
    'Check the official Formula E website closer to the July 25-26, 2026 event.',
    'Confirm timings closer to the 26th.',
    'Verify the shuttle plan closer to race weekend.',
  ]) assert.ok(FUTURE_PROMISE.test(s), s);
});

test('a calendar description with no imperative stays clean', () => {
  for (const s of [
    'The earlier evenings in the run (closer to August 2–3) tend to be somewhat quieter.',   // aomori
    'The earlier evenings in the run (closer to August 2-3) tend to be somewhat quieter.',
    'The lineup was set on July 1 and stayed unchanged.',
    'Doors opened closer to 7pm than the advertised 6pm.',
  ]) assert.ok(!FUTURE_PROMISE.test(s), s);
});

// "closer to your visit" is relative to the reader's date, not the event's;
// on an annual festival it is standing advice and stays true. Boryeong's FAQ.
test('an imperative with "closer to your visit" is standing advice, not a promise', () => {
  assert.ok(!FUTURE_PROMISE.test('Check official festival information closer to your visit.'));
  assert.ok(!FUTURE_PROMISE.test('Confirm prices closer to your trip.'));
  assert.ok(FUTURE_PROMISE.test('Check official festival information closer to the festival.'));
});

// ─── 2026-09-03 ────────────────────────────────────────────────────────────
// Codex review of the imperative branch: it took ANY "closer to" after an
// imperative, so a station entrance and a sunset time were promises, while four
// live promise shapes ("nearer the date", "published closer to showtime") were
// not. The branch now requires a TIME object. All six sentences verbatim.
test('an imperative anchored to a place or a clock reading is not a promise', () => {
  for (const s of [
    'Check the map and use the station entrance closer to the stadium.',
    "check that day's sunset time before booking; in summer that's closer to 9pm.",   // barcelona-mirador-torre-glories
    'Sit closer to the start line for the best view.',
    'Doors opened closer to 7pm than the advertised 6pm.',
  ]) assert.ok(!FUTURE_PROMISE.test(s), s);
});

test('"nearer the date" and the passive "published closer to <time>" are promises', () => {
  for (const s of [
    'check the official schedule nearer the date',                                     // madrid-formula-1-spanish-grand-prix-madring
    'confirm nearer the date',                                                         // kaohsiung-post-malone-big-ass-world-tour
    'exact set times are published closer to showtime by the promoter',                // milan-a-ap-rocky
    'details are usually published by organizers closer to race weekend',              // le-castellet-bol-d-or
    'Check the official Formula E website closer to the July 25-26, 2026 date for the confirmed map.',   // tokyo, still
    'Confirm timings closer to the 26th.',
    'Verify the shuttle plan closer to race weekend.',
  ]) assert.ok(FUTURE_PROMISE.test(s), s);
});

// Codex second pass (2026-09-03): a time noun with a spatial head is a place
// again, and a past-tense report is history, not a promise.
test('a time noun followed by a spatial head is a place, not a time', () => {
  for (const s of [
    'Check the station entrance closer to the event venue.',
    'Verify which hotel is nearer the show grounds.',
    'Check the map and use the gate nearer the start line.',
  ]) assert.ok(!FUTURE_PROMISE.test(s), s);
  assert.ok(FUTURE_PROMISE.test('Check the official site closer to the event.'));   // bare: still a promise
});

test('a past-tense report of when something was published is history, not a promise', () => {
  for (const s of [
    'The 2026 schedule was published closer to race weekend than expected.',
    'The lineup was announced closer to the event than the 2025 lineup.',
    'Set times had been confirmed nearer the date in 2025.',
  ]) assert.ok(!FUTURE_PROMISE.test(s), s);
  for (const s of [
    'exact set times are published closer to showtime by the promoter',
    'details are usually published by organizers closer to race weekend',
    'The schedule is typically announced closer to the event.',
    'Set times will be published closer to showtime.',
  ]) assert.ok(FUTURE_PROMISE.test(s), s);
});

// Codex 3차 (2026-09-03). The FN was live: the Hanoi Super Cup page, four days
// after the match, still told readers the two clubs "won't be known until both
// domestic competitions conclude". The FP was not live but is the same trap the
// past-tense lookbehind was added for — an adverb between the auxiliary and the
// verb walked straight past it.
test("a plain future promise counts even without \"closer to\": won't be known, should be announced", () => {
  for (const s of [
    "The specific two clubs for 2026 won't be known until both domestic competitions conclude.",
    'The final running order will not be confirmed until the week of the show.',
    'Set times should be announced closer to showtime.',
    'Details may be published closer to the date.',
    'The support act might be confirmed nearer the date.',
  ]) assert.ok(FUTURE_PROMISE.test(s), s);
});

test('a past auxiliary still wins when an adverb sits between it and the verb', () => {
  for (const s of [
    'The lineup was usually announced closer to the event.',
    'Set times were typically published closer to showtime.',
  ]) assert.ok(!FUTURE_PROMISE.test(s), s);
  // the present-tense twin of the same sentence is still a promise
  assert.ok(FUTURE_PROMISE.test('The lineup is usually announced closer to the event.'));
});

// Editorial read-through, 2026-09-03: the promise rules were clean while the
// description and FAQ answers still told a reader to go and do things about an
// event that was over. These are the shapes the 15 reviewed pages contained.
test('an instruction the reader can no longer act on is flagged', () => {
  for (const s of [
    'Always confirm dates and ticket details before booking.',
    'Watch official channels for the announcement of set times.',
    'Plan your trip around the airport and book accommodation early.',
    'Check the official Comiket website close to August 2026 for the finalized entry procedure.',
    'Arrive at least 90 minutes early for security screening.',
    'Expect the lineup to be confirmed ahead of the festival.',
    'Verify the current year\'s exact date before finalizing travel plans.',
    'As of this writing, no venue has been named.',
    'Ticketing details had not been locked in this far out.',
    'The exact method was not confirmed at publication time.',
    'The lineup was not set at the time of writing.',
  ]) assert.ok(ADVICE_IMPERATIVE.test(s), s);
});

test('the record of what was planned, and evergreen facts, are not advice', () => {
  for (const s of [
    'The published plan was announced on the official site.',
    'Organisers planned two stages; the official poster listed set times.',
    'The festival was scheduled for August 22–23, 2026 at JIExpo.',
    'Tickets were sold through the official ticketing partner.',
    'Locals arrived early to beat the parking crunch.',
    'The stadium seats 60,000 and sits beside the airport.',
    'Doors opened at 6pm.',
    'Their travel plan was published ahead of the tour.',
    'Locals typically arrive at the arena complex a good hour before doors.',
    'Regulars arrive early to beat the parking crunch.',
    'Fans who plan ahead usually stay on Yas Island.',
  ]) assert.ok(!ADVICE_IMPERATIVE.test(s), s);
});

