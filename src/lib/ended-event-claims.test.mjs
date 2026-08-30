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
