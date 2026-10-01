// Sentences taken from the live guides the 2026-09-30 review checked by hand.
//   node --test src/lib/bookAhead.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendsBooking } from './bookAhead.mjs';

test('guides that recommend booking ahead are recognised', () => {
  for (const s of [
    'Book a timed-entry ticket online in advance — this is one of the most-visited landmarks in the city.',
    'Book your Monumental Zone ticket online in advance and select the earliest slot you can get.',
    'This section requires a paid, timed ticket.',
    'Book online in advance: time slots sell out days or even weeks ahead.',
    'Buy tickets online in advance to skip the queue at the door.',
    'Advance online booking is the easiest way in.',
    'Book a table in advance for dinner on weekends.',
  ]) assert.ok(recommendsBooking(s), s);
});

test('guides that say booking is NOT needed are not flagged', () => {
  for (const s of [
    'No advance booking is needed for the plaza or the market stalls.',
    "There's no need to book ahead; just turn up.",
    'There is rarely a need to book ahead outside festival weekends.',
    "The museum isn't busy enough to require timed entry, so walk-ins are normal.",
    'Most visitors pay at the door rather than pre-booked.',
    'There is no need to pre-book online for the palace grounds.',
    'There is little need to book ahead on weekdays.',
  ]) assert.ok(!recommendsBooking(s), s);
});

test('selling out and other places named in a list are not booking advice', () => {
  assert.ok(!recommendsBooking('The pastry case sells out of popular items by mid-morning on weekends.'));
  assert.ok(!recommendsBooking('- **Shibuya Sky**, a rooftop observation deck; tickets are timed-entry and best booked online in advance.'));
  assert.ok(recommendsBooking('- **Book ahead online.** Timed-entry tickets are standard here.'));
});

test('"rather than" counts by which side of the advice it sits (Codex review, 10-01)', () => {
  assert.ok(recommendsBooking('Book online in advance through the official teamLab Planets site rather than assuming walk-up entry will be possible.'));
  assert.ok(recommendsBooking('Book a timed-entry ticket online in advance rather than queuing at the door.'));
  assert.ok(!recommendsBooking('Buy your ticket at the small booth by the entrance rather than assuming you need to book online in advance.'));
  assert.ok(!recommendsBooking('Most visitors simply turn up instead of booking in advance.'));
});

test('an item label is not another place, an optional amenity is not the visit (Codex review, 10-01)', () => {
  assert.ok(recommendsBooking('- **Tickets**: buy online in advance during peak season to skip the ticket-counter line.'));
  assert.ok(recommendsBooking('- **Reservations:** book a table in advance for Friday dinner.'));
  assert.ok(!recommendsBooking('- Book a barbecue pit ahead if you want one on a weekend; most people just walk the promenade.'));
  assert.ok(!recommendsBooking('Book bikes ahead at the rental kiosk on public holidays.'));
});

test('a negation counts in the advice clause; a dismissal anywhere (Codex review, 10-01)', () => {
  assert.ok(recommendsBooking("Bangkok's rooftop-bar culture runs on reservations, not walk-in luck, so call or book online ahead rather than arriving unannounced."));
  assert.ok(!recommendsBooking("Book ahead online, though it's not strictly necessary on weekdays."));
  // Measured on every guide: these were read as advice when negation was clause-only.
  assert.ok(!recommendsBooking("There's no ticket booth at the trailhead, so there's nothing to book in advance."));
  assert.ok(!recommendsBooking("There's no metro line to the site, so a pre-booked taxi or app-based auto is the practical option."));
  assert.ok(!recommendsBooking('Most visitors arrive by rental car or a pre-booked shuttle.'));
  assert.ok(!recommendsBooking('Book an evening geisha performance in advance if you want to see one; these are by reservation, not walk-in.'));
  assert.ok(!recommendsBooking('Booking ahead is optional, since the hall rarely fills.'));
  assert.ok(!recommendsBooking("You don't need to book ahead; just turn up."));
});

test('a body is flagged when any one sentence recommends booking', () => {
  assert.ok(recommendsBooking('Walk-ins are fine at the café.\n\nFor the rooftop, book a timed-entry ticket online ahead.'));
  assert.ok(!recommendsBooking('A calm park.\n\nNo need to book ahead.'));
});
