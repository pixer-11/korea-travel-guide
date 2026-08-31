import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FUTURE_PROMISE, FABRICATED_AVAILABILITY, OFFENDING_CLAIM } from './ended-event-claims.mjs';

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
