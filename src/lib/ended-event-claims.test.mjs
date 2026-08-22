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
